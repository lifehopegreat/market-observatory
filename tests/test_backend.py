import asyncio
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from backend import store, providers
from backend.app import app, active, last_call
from backend.data import parse_import
from backend.models import ImportRequest

HEADERS = {'X-Observatory-Request': '1', 'Content-Type': 'application/json'}


def import_request(**values):
    return ImportRequest(name='Test official series', unit='people', source_name='test', source_url='https://example.com/data',
                         csv_text=values.pop('csv_text', 'date,value\n2023,100\n2024,110\n2025,\n'), **values)


class ImportTests(unittest.TestCase):
    def test_preserves_missing_and_unit(self):
        d = parse_import(import_request())
        self.assertIsNone(d['points'][-1]['value'])
        self.assertEqual(d['unit'], 'people')

    def test_duplicate_and_nan_rejected(self):
        for csv_text in ('date,value\n2024,1\n2024,2', 'date,value\n2024,NaN', 'date,value\n2024,inf', 'date,value\n2024,1,2'):
            with self.subTest(csv_text=csv_text), self.assertRaises(ValueError):
                parse_import(import_request(csv_text=csv_text))

    def test_invalid_dates(self):
        for freq, day in [('monthly', '2024-13'), ('quarterly', '2024-Q5'), ('daily', '2024-02-30')]:
            with self.subTest(freq=freq), self.assertRaises(ValueError):
                parse_import(import_request(frequency=freq, csv_text=f'date,value\n{day},1'))

    def test_ohlc_bounds(self):
        bad = 'date,open,high,low,close\n2024-01-01,10,9,8,11'
        with self.assertRaises(ValueError):
            parse_import(import_request(kind='ohlc', frequency='daily', csv_text=bad))
        good = 'date,open,high,low,close,volume\n2024-01-01,10,12,8,11,30'
        self.assertEqual(parse_import(import_request(kind='ohlc', frequency='daily', csv_text=good))['points'][0]['close'], 11)

    def test_composition_enforces_same_date_and_nonnegative(self):
        for text in ['date,category,value\n2024-01-01,A,-1', 'date,category,value\n2024-01-01,A,1\n2024-01-02,B,2', 'date,category,value\n2024-01-01,A,0']:
            with self.subTest(text=text), self.assertRaises(ValueError):
                parse_import(import_request(kind='composition', frequency='snapshot', mutually_exclusive=True, csv_text=text))


class APITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = patch.object(store, 'DATA', Path(self.temp.name))
        self.db = patch.object(store, 'DB', Path(self.temp.name) / 'test.sqlite')
        self.path.start(); self.db.start()
        active.clear(); last_call.clear()
        self.client = TestClient(app, headers=HEADERS)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.path.stop(); self.db.stop(); self.temp.cleanup()

    def post_import(self):
        return self.client.post('/api/import', json=import_request().model_dump(mode='json'))

    def test_empty_bootstrap_does_not_fabricate(self):
        b = self.client.get('/api/bootstrap').json()
        self.assertEqual(b['evidence'], [])
        self.assertTrue(all(not d['points'] for d in b['datasets']))
        self.assertEqual(len(b['datasets']), 12)

    def test_cross_origin_and_simple_requests_blocked(self):
        self.assertEqual(self.client.post('/api/import', headers={'Origin': 'https://evil.example'}, json={}).status_code, 403)
        with TestClient(app) as c:
            self.assertEqual(c.post('/api/import', json={}).status_code, 403)
        self.assertEqual(self.client.get('/api/health', headers={'Host': 'evil.example'}).status_code, 400)

    def test_request_validation_does_not_echo_credentials(self):
        token = 'DUMMY-SECRET-' + 'x' * 1001
        r = self.client.put('/api/settings', json={'model_key': token})
        self.assertEqual(r.status_code, 422)
        self.assertNotIn('DUMMY-SECRET', r.text)
        self.assertNotIn('input', r.text)

    def test_atomic_import_rejects_bad_rows(self):
        r = self.client.post('/api/import', json=import_request(csv_text='date,value\n2024,1\n2024,2').model_dump(mode='json'))
        self.assertEqual(r.status_code, 400)
        self.assertEqual(store.listing('datasets'), [])

    def test_snapshot_dedup_export_and_persistence(self):
        r = self.post_import()
        self.assertEqual(r.status_code, 200)
        id = r.json()['id']
        d = store.get('datasets', id)
        store.save_datasets([d])
        snaps = self.client.get(f'/api/datasets/{id}/snapshots').json()
        self.assertEqual(len(snaps), 1)
        d['points'][0]['value'] = 99
        store.save_datasets([d])
        snaps = self.client.get(f'/api/datasets/{id}/snapshots').json()
        self.assertEqual(len(snaps), 2)
        self.assertEqual(self.client.get(f"/api/snapshots/{snaps[-1]['id']}").json()['points'][0]['value'], 100)
        exported = self.client.get(f'/api/datasets/{id}/csv')
        self.assertIn('source_url', exported.text)
        store.init()
        self.assertEqual(store.get('datasets', id)['points'][0]['value'], 99)

    def test_csv_formula_injection_is_escaped(self):
        req = import_request(kind='composition', frequency='snapshot', mutually_exclusive=True,
                             csv_text='date,category,value\n2024-01-01,=1+2,3')
        id = self.client.post('/api/import', json=req.model_dump(mode='json')).json()['id']
        self.assertIn("'=1+2", self.client.get(f'/api/datasets/{id}/csv').text)

    def test_public_opinion_verification_needs_sample(self):
        payload = {'title': 'Survey', 'dimension': '公众意愿', 'source_name': 'Survey office', 'url': 'https://example.com', 'summary': 'test sample summary', 'verified': True}
        self.assertEqual(self.client.post('/api/evidence', json=payload).status_code, 422)
        payload['sample_note'] = 'n unknown; not representative'
        self.assertEqual(self.client.post('/api/evidence', json=payload).status_code, 200)

    def test_brief_has_sources_and_survives_evidence_deletion(self):
        self.post_import()
        p = {'title': 'Policy evidence', 'dimension': '政策', 'source_name': 'test', 'url': 'https://example.com', 'summary': 'test verified summary', 'verified': True}
        e = self.client.post('/api/evidence', json=p).json()
        r = self.client.post('/api/research', json={'question': 'What does the evidence support?', 'mode': 'brief'}).json()
        self.client.request('DELETE', '/api/evidence/' + e['id'], json={})
        saved = store.get('reports', r['id'])
        self.assertEqual(saved['context']['evidence'][0]['summary'], p['summary'])
        self.assertTrue(saved['body']['claims'][0]['refs'])
        self.assertEqual(self.client.get('/api/research/' + r['id'] + '/export').status_code, 200)

    def test_upstream_failure_keeps_data_and_logs_error(self):
        self.post_import()
        with patch.object(providers, 'sync', AsyncMock(side_effect=ValueError('upstream timeout'))):
            r = self.client.post('/api/sync', json={})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(len(store.listing('datasets')), 1)
        self.assertEqual(self.client.get('/api/bootstrap').json()['logs'][0]['success'], 0)

    def test_missing_key_is_explicit(self):
        with patch.object(store, 'settings', return_value={'fred_key': '', 'tushare_key': '', 'tavily_key': ''}):
            self.assertEqual(self.client.post('/api/sync', json={'provider': 'fred'}).status_code, 400)
            self.assertEqual(self.client.post('/api/search', json={'query': 'test'}).status_code, 400)

    def test_plaintext_not_stored_or_returned(self):
        import os
        if os.name != 'nt':
            self.skipTest('DPAPI is Windows only')
        dummy = 'TEST-ONLY-credential-not-real'
        self.client.put('/api/settings', json={'model_key': dummy, 'model': 'test-model'})
        self.assertNotIn(dummy, self.client.get('/api/settings').text)
        with store.connect() as c:
            raw = c.execute('SELECT payload FROM config').fetchone()[0]
        self.assertNotIn(dummy, raw)
        self.assertEqual(store.settings(secret=True)['model_key'], dummy)

    def test_ai_external_consent_required(self):
        self.post_import()
        r = self.client.post('/api/research', json={'question': 'What does the evidence support?', 'mode': 'ai', 'consent': False})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(store.listing('reports'), [])

    def test_model_unknown_citation_rejected(self):
        self.post_import()
        report = {'summary': 'test', 'claims': [{'text': 'test', 'nature': '假设', 'refs': ['made-up']}], 'mechanism': ['x'], 'scenarios': [{'name': 'a', 'assumptions': 'a', 'triggers': 'a'}, {'name': 'b', 'assumptions': 'b', 'triggers': 'b'}], 'invalidation': ['x'], 'missing': ['x']}
        response = {'choices': [{'message': {'content': json.dumps(report)}}]}
        cfg = {'model': 'dummy', 'model_key': 'dummy', 'model_base_url': 'https://example.com', 'trust_proxy': False}
        with patch.object(store, 'settings', return_value=cfg), patch.object(providers, 'request_json', AsyncMock(return_value=response)):
            with self.assertRaisesRegex(ValueError, '引用'):
                asyncio.run(providers.generate_ai({}, {'datasets': store.listing('datasets'), 'evidence': []}))


if __name__ == '__main__':
    unittest.main()
