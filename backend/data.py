import csv
import io
import math
import re
from datetime import date

from .models import ImportRequest
from .store import now, uid

INDICATORS = [
    ('gdp', '实际 GDP 增速', 'NY.GDP.MKTP.KD.ZG', '%', 'rate', '宏观'),
    ('cpi', '居民消费价格涨幅', 'FP.CPI.TOTL.ZG', '%', 'rate', '民生'),
    ('unemployment', '失业率（ILO模型估计）', 'SL.UEM.TOTL.ZS', '%', 'rate', '民生'),
    ('consumption', '居民最终消费实际增速', 'NE.CON.PRVT.KD.ZG', '%', 'rate', '居民消费'),
    ('manufacturing', '制造业增加值占 GDP', 'NV.IND.MANF.ZS', '%', 'share', '制造业'),
    ('services', '服务业增加值占 GDP', 'NV.SRV.TOTL.ZS', '%', 'share', '服务业'),
    ('industry', '工业增加值占 GDP（含建筑）', 'NV.IND.TOTL.ZS', '%', 'share', '工业'),
    ('agriculture', '农业增加值占 GDP', 'NV.AGR.TOTL.ZS', '%', 'share', '农业'),
    ('exports', '商品与服务出口占 GDP', 'NE.EXP.GNFS.ZS', '%', 'share', '外贸'),
    ('income', '人均国民总收入（现价美元）', 'NY.GNP.PCAP.CD', '美元', 'level', '民生'),
    ('population', '总人口', 'SP.POP.TOTL', '人', 'level', '人口'),
    ('investment', '资本形成总额占 GDP', 'NE.GDI.TOTL.ZS', '%', 'share', '宏观'),
]
REGIONS = {'CHN': '中国', 'USA': '美国', 'WLD': '全球'}


def catalog(region):
    return [{'id': f'wb:{region}:{slug}', 'name': name, 'indicator': code,
             'provider': 'worldbank', 'source_name': '世界银行 · WDI',
             'source_url': f'https://data.worldbank.org/indicator/{code}?locations={region}',
             'unit': unit, 'semantic': semantic, 'frequency': 'annual', 'kind': 'timeseries',
             'region': region, 'sector': sector, 'points': [], 'published_at': None,
             'note': '年度历史数据；发布日期未知；失业率为模型估计，不等同于中国城镇调查失业率。' if slug == 'unemployment' else '年度历史数据；来源更新时间不是各观测值首次发布日期。'}
            for slug, name, code, unit, semantic, sector in INDICATORS]


def number(v, nullable=False):
    if nullable and (v is None or str(v).strip() in ('', '.', 'NA', 'N/A', 'null')):
        return None
    try:
        n = float(v)
        if not math.isfinite(n):
            raise ValueError()
        return n
    except (ValueError, TypeError):
        raise ValueError('数值必须为有限数字；缺失值请留空') from None


def valid_period(v, frequency):
    patterns = {'annual': r'\d{4}', 'monthly': r'\d{4}-(0[1-9]|1[0-2])',
                'quarterly': r'\d{4}-Q[1-4]', 'daily': r'\d{4}-\d{2}-\d{2}', 'snapshot': r'\d{4}-\d{2}-\d{2}'}
    if not re.fullmatch(patterns[frequency], v):
        raise ValueError(f'日期 {v!r} 不符合频率 {frequency}：年 YYYY / 月 YYYY-MM / 季 YYYY-Qn / 日 YYYY-MM-DD')
    if frequency in ('daily', 'snapshot'):
        date.fromisoformat(v)
    return v


def parse_import(req: ImportRequest):
    reader = csv.DictReader(io.StringIO(req.csv_text.lstrip('\ufeff')))
    fields = set(reader.fieldnames or [])
    required = {'date', 'value'} if req.kind == 'timeseries' else {'date', 'open', 'high', 'low', 'close'} if req.kind == 'ohlc' else {'date', 'category', 'value'}
    if not required <= fields:
        raise ValueError('CSV 缺少列：' + ', '.join(sorted(required - fields)))
    if req.kind == 'composition' and (not req.mutually_exclusive or req.frequency != 'snapshot'):
        raise ValueError('构成数据必须声明分类互斥，并选择同一时点频率')
    if req.kind == 'ohlc' and req.frequency != 'daily':
        raise ValueError('K线导入当前要求日频真实 OHLC')
    if req.kind == 'composition' and req.semantic == 'rate':
        raise ValueError('增长率不是构成数据')
    points, seen = [], set()
    for i, row in enumerate(reader, 2):
        if i > 20001:
            raise ValueError('单次最多导入 20000 行')
        if None in row:
            raise ValueError(f'第 {i} 行列数与标题不符')
        p = {'date': valid_period((row.get('date') or '').strip(), req.frequency)}
        if req.kind == 'ohlc':
            p.update({k: number(row[k]) for k in ('open', 'high', 'low', 'close')})
            if p['low'] > min(p['open'], p['close']) or p['high'] < max(p['open'], p['close']) or p['low'] > p['high']:
                raise ValueError(f'第 {i} 行 OHLC 高低价关系错误')
            # shortcut: positive daily equity prices only; expand validation before supporting negative futures prices.
            if min(p[k] for k in ('open', 'high', 'low', 'close')) <= 0:
                raise ValueError(f'第 {i} 行价格必须大于零')
            if 'volume' in row and row['volume']:
                p['volume'] = number(row['volume'])
                if p['volume'] < 0:
                    raise ValueError('成交量不能为负数')
        else:
            p['value'] = number(row.get('value'), nullable=req.kind == 'timeseries')
        if req.kind == 'composition':
            p['category'] = (row.get('category') or '').strip()
            if not p['category'] or len(p['category']) > 100 or p['value'] < 0:
                raise ValueError('构成分类不可为空，数值不可为负数')
        key = (p['date'], p.get('category', ''))
        if key in seen:
            raise ValueError(f'第 {i} 行日期/分类重复，不自动覆盖')
        seen.add(key)
        points.append(p)
    if not points or not any(p.get('value', p.get('close')) is not None for p in points):
        raise ValueError('没有有效数据')
    if req.kind == 'composition' and (len({p['date'] for p in points}) != 1 or sum(p['value'] for p in points) <= 0):
        raise ValueError('构成数据必须是同一日期，且合计大于零')
    return {**req.model_dump(mode='json', exclude={'csv_text', 'mutually_exclusive'}), 'id': uid('csv'),
            'provider': 'csv', 'points': sorted(points, key=lambda p: p['date']), 'fetched_at': now(),
            'note': '用户导入；来源与口径尚需人工核验。' + (' 构成占比以本表合计为分母。' if req.kind == 'composition' else '')}


def stats(dataset):
    valid = [p for p in dataset['points'] if p.get('value', p.get('close')) is not None]
    if not valid:
        return None
    values = [p.get('value', p.get('close')) for p in valid]
    return {'count': len(valid), 'missing': len(dataset['points']) - len(valid), 'first': valid[0]['date'],
            'latest_period': valid[-1]['date'], 'latest': values[-1], 'min': min(values), 'max': max(values),
            'mean': sum(values) / len(values), 'previous': values[-2] if len(values) > 1 else None}
