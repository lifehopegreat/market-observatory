import asyncio
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from backend import providers, store, updater
from backend.app import app
from backend.models import EvidenceInput, MaterialBatch, MaterialExtraction, UpdatePlan, UpdateRequest


QUOTE = '这是测试专用的公开正文依据片段，不是实际经济材料。'
TODAY = datetime.now(timezone(timedelta(hours=8))).date()
BODY = f'发布时间：{TODAY.isoformat()}\n{QUOTE}\n' + '测试内容仅用于隔离单元测试，不代表真实市场数据。' * 20


def extraction(**extra):
    return MaterialExtraction(source_id='s1', nature='事实', source_type='官方机构', published_at=TODAY,
                              date_quote=f'发布时间：{TODAY.isoformat()}', basis_quote=QUOTE,
                              summary='测试整理摘要，不是真实经济信息。', mechanism='待验证的传导路径。',
                              counterevidence='仅为测试，不构成实际证据。', sample_note='非真实样本，不能推断公众比例。', **extra)


class UpdateTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = patch.object(store, 'DATA', Path(self.temp.name))
        self.db = patch.object(store, 'DB', Path(self.temp.name) / 'test.sqlite')
        self.path.start(); self.db.start()
        store.init(); updater.init()

    async def asyncTearDown(self):
        await updater.shutdown()
        self.path.stop(); self.db.stop(); self.temp.cleanup()

    def job(self, sync=False):
        req = UpdateRequest(sync_data=sync, consent=True)
        job = {'id': store.uid('update'), 'status': 'queued', 'request': req.model_dump(), 'created_at': store.now(),
               'finished_at': None, 'trigger': 'manual', 'stage': '', 'completed': 0, 'total': 7 if sync else 6,
               'added': 0, 'revised': 0, 'duplicates': 0, 'datasets': 0, 'errors': [], 'items': [], 'steps': []}
        with store.connect() as c:
            c.execute('INSERT INTO update_jobs VALUES(?,?,?)', (job['id'], job['status'], store.dumps(job)))
        return req, job

    def page(self, body=BODY):
        return {'title': '测试专用材料', 'url': 'https://example.com/public', 'source_name': '测试来源', 'content': body,
                'digest': updater.digest(body), 'retrieved_at': store.now()}

    def test_url_canonicalization_and_private_or_secret_rejection(self):
        self.assertEqual(updater.canonical_url('https://EXAMPLE.com/doc/?b=2&utm_source=x&a=1#section'), 'https://example.com/doc?a=1&b=2')
        for url in ('http://example.com', 'https://127.0.0.1/a', 'https://localhost/a', 'https://a.internal/a',
                    'https://u:p@example.com/a', 'https://example.com/a?token=secret', 'https://example.com:8888/a'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                updater.canonical_url(url)

    def test_model_cannot_supply_verified_or_arbitrary_urls(self):
        value = extraction().model_dump(mode='json')
        for key, val in (('verified', True), ('url', 'https://wrong.example.com')):
            with self.subTest(key=key), self.assertRaises(ValueError):
                MaterialBatch.model_validate({'materials': [{**value, key: val}]})

    def test_versions_dedup_preserve_manual_and_report(self):
        old = {**EvidenceInput(title='旧人工材料', dimension='政策', source_name='测试', url='https://example.com/public/', summary='旧摘要保持不变。', verified=True).model_dump(mode='json'), 'id': 'manual', 'created_at': store.now()}
        store.save('evidence', old)
        report = store.save('reports', {'id': 'report', 'context': {'evidence': [old]}})
        value = {k:v for k,v in old.items() if k not in ('id','created_at')}
        value.update(summary='新的AI摘要。', verified=False)
        status, id, prev = updater.remember(value, self.page(), 'job')
        self.assertEqual((status, prev), ('revised', 'manual'))
        self.assertEqual(updater.remember(value, self.page(), 'job')[0], 'duplicate')
        self.assertEqual(len(store.listing('evidence')), 2)
        self.assertEqual(store.get('evidence', 'manual'), old)
        self.assertEqual(store.get('reports', 'report'), report)
        second = updater.remember(value, self.page(BODY+'正文修订'), 'job')
        self.assertEqual((second[0], second[2]), ('revised', id))
        self.assertEqual(updater.source(id)['digest'], updater.digest(BODY))
        self.assertEqual(updater.source(id)['previous_id'], 'manual')

    async def test_search_snippet_is_not_full_content(self):
        req, job = self.job()
        with patch.object(providers, 'search', AsyncMock(return_value=[{**self.page(), 'content': '', 'summary': BODY}])), patch.object(providers, 'extract_materials', AsyncMock()) as ai:
            await updater.update_dimension(req, '政策', job)
        ai.assert_not_awaited()
        self.assertEqual(store.listing('evidence'), [])
        self.assertEqual(job['items'][0]['status'], 'skipped')

    async def test_unknown_source_is_rejected_without_discarding_valid_source(self):
        req, job = self.job()
        bad = extraction().model_copy(update={'source_id': 'invented'})
        with patch.object(providers, 'search', AsyncMock(return_value=[self.page()])), patch.object(providers, 'extract_materials', AsyncMock(return_value=[extraction(), bad])):
            await updater.update_dimension(req, '政策', job)
        self.assertEqual(len(store.listing('evidence')), 1)
        self.assertEqual(len(job['errors']),1)
        self.assertIn('未知来源',job['errors'][0])

    async def test_multiple_claims_from_one_source_only_saved_once(self):
        req, job = self.job()
        with patch.object(providers, 'search', AsyncMock(return_value=[self.page()])), patch.object(providers, 'extract_materials', AsyncMock(return_value=[extraction(),extraction()])):
            await updater.update_dimension(req,'政策',job)
        self.assertEqual(len(store.listing('evidence')),1)
        self.assertEqual(job['items'][1]['status'],'skipped')

    async def test_quote_date_and_opinion_guards(self):
        req, job = self.job()
        with patch.object(providers, 'search', AsyncMock(return_value=[self.page()])), patch.object(providers, 'extract_materials', AsyncMock(return_value=[extraction().model_copy(update={'date_quote': '不存在的日期依据'})])):
            await updater.update_dimension(req, '公众意愿', job)
        evidence = store.listing('evidence')[0]
        self.assertIsNone(evidence['published_at'])
        self.assertEqual(evidence['nature'], '观点')
        self.assertFalse(evidence['verified'])
        self.assertIn('AI整理', evidence['sample_note'])
        self.assertIn('发布日期', evidence['sample_note'])

    async def test_future_old_or_unsupported_quotes_are_skipped(self):
        req, job = self.job()
        for value in [extraction().model_copy(update={'published_at': TODAY+timedelta(days=1)}),
                      extraction().model_copy(update={'basis_quote': '模型编造了这个正文中不存在的引文片段'})]:
            with patch.object(providers, 'search', AsyncMock(return_value=[self.page()])), patch.object(providers, 'extract_materials', AsyncMock(return_value=[value])):
                await updater.update_dimension(req, '政策', job)
        self.assertEqual(store.listing('evidence'), [])

    async def test_partial_failure_keeps_other_dimensions_and_provenance(self):
        _, job = self.job()
        async def search(req, **kwargs):
            if req.dimension == '财报':
                raise ValueError('network')
            body = f'发布时间：{TODAY.isoformat()}\n{QUOTE}\n' + ''.join(f'{req.dimension}第{i}项是专用的隔离测试材料。' for i in range(80))
            return [{**self.page(body), 'url': 'https://example.com/'+req.dimension}]
        with patch.object(providers, 'search', search), patch.object(providers, 'extract_materials', AsyncMock(return_value=[extraction()])):
            await updater.run(job)
        self.assertEqual(job['status'], 'partial')
        self.assertEqual(job['completed'], 6)
        self.assertEqual(job['added'], 5)
        self.assertEqual(len(job['errors']), 1)
        for e in store.listing('evidence'):
            self.assertFalse(e['verified'])
            self.assertEqual(updater.source(e['id'])['run_id'], job['id'])

    async def test_second_run_does_not_call_model_for_unchanged_pages(self):
        req, job = self.job()
        with patch.object(providers, 'search', AsyncMock(return_value=[self.page()])), patch.object(providers, 'extract_materials', AsyncMock(return_value=[extraction()])) as ai:
            await updater.update_dimension(req, '政策', job)
            await updater.update_dimension(req, '政策', job)
        self.assertEqual(ai.await_count, 1)
        self.assertEqual(len(store.listing('evidence')), 1)
        self.assertEqual(job['duplicates'], 1)

    async def test_sync_only_updates_existing_api_series_not_csv(self):
        for id, provider, region in [('UNRATE','fred','USA'), ('000001.SZ','tushare','CHN'), ('manual','csv','CHN')]:
            store.save_datasets([{'id':id, 'provider':provider, 'region':region, 'indicator':id, 'points':[], 'fetched_at':store.now()}])
        req, job = self.job(sync=True)
        with patch.object(providers, 'sync', AsyncMock(return_value=[{}])) as sync:
            await updater.sync_existing(req, job)
        self.assertEqual([c.args[0].provider for c in sync.await_args_list], ['worldbank', 'tushare'])

    async def test_schedule_catches_up_once_and_disable_persists(self):
        with patch.object(updater, 'ready', return_value=(True,'')):
            saved = updater.save_plan(UpdatePlan(enabled=True, consent=True))
        saved['next_run_at']=(datetime.now(timezone.utc)-timedelta(days=5)).isoformat()
        with store.connect() as c:
            c.execute('UPDATE update_plan SET payload=?', (store.dumps(saved),))
        with patch.object(updater, 'start') as start:
            await updater.tick(); await updater.tick()
        self.assertEqual(start.call_count,1)
        self.assertEqual(start.call_args.args[1], 'scheduled')
        updater.init()
        self.assertTrue(updater.plan()['enabled'])
        updater.save_plan(UpdatePlan(enabled=False))
        self.assertIsNone(updater.plan()['next_run_at'])

    def test_restart_marks_unfinished_interrupted_without_deleting_evidence(self):
        _, job = self.job()
        updater.init()
        self.assertEqual(updater.get_job(job['id'])['status'], 'interrupted')
        self.assertIsNone(updater.state()['active'])

    async def test_all_failed_is_not_success(self):
        _, job = self.job()
        with patch.object(providers, 'search', AsyncMock(side_effect=ValueError('no quota'))):
            await updater.run(job)
        self.assertEqual(job['status'], 'failed')
        self.assertEqual(len(job['errors']), 6)
        self.assertEqual(store.listing('evidence'), [])

    async def test_search_requests_body_not_snippet_when_updating(self):
        cfg = {'model_base_url':'https://api.deepseek.com/v1', 'model_key':'DUMMY', 'tavily_key':'', 'trust_proxy':False}
        response = {'results':[{'url':'https://example.com/doc', 'title':'测试材料', 'summary':'search summary', 'content':BODY}]}
        from backend.models import SearchRequest
        with patch.object(store, 'settings', return_value=cfg), patch.object(providers, 'request_json', AsyncMock(return_value=response)) as call:
            result = await providers.search(SearchRequest(query='中国市场'), full_content=True)
        self.assertTrue(call.call_args.kwargs['json']['need_content'])
        self.assertEqual(result[0]['content'], BODY)
        self.assertNotEqual(result[0]['content'], result[0]['summary'])

    async def test_financial_questions_rejected_and_pdf_fallback_used(self):
        req, job = self.job()
        records = [{**self.page(), 'title':'问答', 'url':'https://irm.cninfo.com.cn/question/1'},
                   {**self.page(), 'title':'测试公司第三季度报告', 'url':'https://static.cninfo.com.cn/report.pdf', 'content':''}]
        with patch.object(providers, 'search', AsyncMock(return_value=records)), patch.object(providers, 'financial_pdf', AsyncMock(return_value=BODY)) as pdf, patch.object(providers, 'extract_materials', AsyncMock(return_value=[extraction()])):
            await updater.update_dimension(req, '财报', job)
        pdf.assert_awaited_once()
        self.assertEqual(job['added'],1)
        self.assertEqual(job['items'][0]['status'],'skipped')
        self.assertIn('PDF前6页',store.listing('evidence')[0]['sample_note'])

    async def test_near_reprints_are_not_counted_as_two_sources(self):
        req, job = self.job()
        body = BODY + ''.join(f'第{i}条行业测试内容只能用于自动测试。' for i in range(80))
        records = [{**self.page(body), 'url':'https://example.com/first'},
                   {**self.page('转载页导航\n'+body+'\n转载版权说明'), 'url':'https://example.net/reprint'}]
        with patch.object(providers, 'search', AsyncMock(return_value=records)), patch.object(providers, 'extract_materials', AsyncMock(return_value=[extraction()])) as ai:
            await updater.update_dimension(req,'政策',job)
        self.assertEqual(len(ai.call_args.args[0]),1)
        self.assertEqual(job['duplicates'],1)
        self.assertEqual(len(store.listing('evidence')),1)

    async def test_pdf_reader_rejects_arbitrary_hosts_before_network(self):
        with patch.object(providers.httpx, 'AsyncClient') as client:
            for url in ('https://example.com/evil.pdf','https://127.0.0.1/private.pdf','https://u:p@static.cninfo.com.cn/a.pdf'):
                with self.subTest(url=url), self.assertRaises(ValueError):
                    await providers.financial_pdf(url)
            client.assert_not_called()

    async def test_start_requires_consent_and_rejects_concurrent_run(self):
        with self.assertRaisesRegex(ValueError, '同意'):
            updater.start(UpdateRequest())
        with patch.object(updater, 'ready', return_value=(True,'')), patch.object(updater, 'run', AsyncMock()):
            job = updater.start(UpdateRequest(consent=True))
            with self.assertRaises(ValueError):
                updater.start(UpdateRequest(consent=True))
            self.assertEqual(updater.get_job(job['id'])['status'], 'queued')

    def test_api_errors_and_schedule_defaults_are_explicit(self):
        with TestClient(app, headers={'X-Observatory-Request':'1'}) as client:
            state = client.get('/api/updates').json()
            self.assertFalse(state['plan']['enabled'])
            self.assertEqual(client.post('/api/updates', json={'consent':False}).status_code, 400)
            self.assertEqual(client.put('/api/updates/plan', json={'enabled':True,'consent':False}).status_code, 400)
            self.assertEqual(client.get('/api/updates/missing').status_code, 404)
            self.assertEqual(client.get('/api/evidence/missing/source').status_code, 404)


if __name__ == '__main__':
    unittest.main()
