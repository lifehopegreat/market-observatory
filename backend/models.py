from datetime import date
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Dimension = Literal['官方数据', '政策', '财报', '市场预期', '业内信息', '民生', '公众意愿']


def safe_url(value: str, allow_local: bool = False) -> str:
    p = urlparse(value)
    local = p.hostname in ('localhost', '127.0.0.1', '::1')
    if p.username or p.password or p.query or p.fragment:
        raise ValueError('URL 不可含账号、密钥、查询参数或片段')
    if not p.hostname or (p.scheme != 'https' and not (allow_local and local and p.scheme == 'http')):
        raise ValueError('请使用 HTTPS URL（本机模型可使用回环 HTTP）')
    return value.rstrip('/')


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class SyncRequest(StrictModel):
    provider: Literal['worldbank', 'fred', 'tushare'] = 'worldbank'
    region: Literal['CHN', 'USA', 'WLD'] = 'CHN'
    series_id: str = Field(default='UNRATE', pattern=r'^[A-Za-z0-9_.-]{1,64}$')
    ts_code: str = Field(default='000001.SZ', pattern=r'^\d{6}\.(SH|SZ|BJ)$')


class ImportRequest(StrictModel):
    name: str = Field(min_length=2, max_length=100)
    unit: str = Field(min_length=1, max_length=40)
    frequency: Literal['annual', 'quarterly', 'monthly', 'daily', 'snapshot'] = 'annual'
    kind: Literal['timeseries', 'ohlc', 'composition'] = 'timeseries'
    semantic: Literal['level', 'rate', 'share', 'index'] = 'level'
    region: Literal['CHN', 'USA', 'WLD'] = 'CHN'
    sector: str = Field(default='宏观', max_length=40)
    source_name: str = Field(min_length=1, max_length=100)
    source_url: str = Field(min_length=8, max_length=1000)
    published_at: date | None = None
    mutually_exclusive: bool = False
    csv_text: str = Field(min_length=10, max_length=2_000_000)

    @field_validator('source_url')
    @classmethod
    def url(cls, v):
        p = urlparse(v)
        if p.scheme != 'https' or not p.hostname or p.username or p.password:
            raise ValueError('来源必须是无内嵌凭据的 HTTPS URL')
        return v


class EvidenceInput(StrictModel):
    title: str = Field(min_length=2, max_length=200)
    dimension: Dimension
    nature: Literal['事实', '观点', '假设'] = '观点'
    source_type: Literal['官方机构', '公司披露', '研究机构', '行业组织', '调查', '社区', '其他'] = '其他'
    source_name: str = Field(min_length=1, max_length=100)
    url: str = Field(min_length=8, max_length=2000)
    published_at: date | None = None
    effective_at: date | None = None
    sector: str = Field(default='宏观', min_length=1, max_length=60)
    region: Literal['CHN', 'USA', 'WLD'] = 'CHN'
    summary: str = Field(min_length=5, max_length=12000)
    mechanism: str = Field(default='', max_length=2000)
    counterevidence: str = Field(default='', max_length=2000)
    sample_note: str = Field(default='', max_length=1000)
    policy_stage: Literal['不适用', '意图', '预算', '实施', '效果评估'] = '不适用'
    verified: bool = False

    @field_validator('url')
    @classmethod
    def url(cls, v):
        p = urlparse(v)
        if p.scheme != 'https' or not p.hostname or p.username or p.password:
            raise ValueError('来源必须是无内嵌凭据的 HTTPS URL')
        return v

    @model_validator(mode='after')
    def policy(self):
        if self.dimension != '政策' and self.policy_stage != '不适用':
            raise ValueError('非政策证据不能设置政策阶段')
        if self.verified and self.dimension == '公众意愿' and not self.sample_note:
            raise ValueError('核验公众意愿材料时必须说明样本与代表性限制')
        return self


class SearchRequest(StrictModel):
    query: str = Field(min_length=2, max_length=300)
    dimension: Dimension = '政策'
    sector: str = Field(default='宏观', max_length=60)
    region: Literal['CHN', 'USA', 'WLD'] = 'CHN'


class UpdateRequest(StrictModel):
    region: Literal['CHN', 'USA', 'WLD'] = 'CHN'
    sector: str = Field(default='宏观', min_length=1, max_length=30)
    lookback_days: int = Field(default=90, ge=7, le=365)
    sync_data: bool = True
    consent: bool = False


class UpdatePlan(UpdateRequest):
    enabled: bool = False


class MaterialExtraction(StrictModel):
    source_id: str = Field(min_length=1, max_length=30)
    nature: Literal['事实', '观点', '假设']
    source_type: Literal['官方机构', '公司披露', '研究机构', '行业组织', '调查', '社区', '其他']
    published_at: date | None = None
    date_quote: str = Field(default='', max_length=200)
    basis_quote: str = Field(min_length=10, max_length=1000)
    summary: str = Field(min_length=5, max_length=1500)
    mechanism: str = Field(min_length=5, max_length=1000)
    counterevidence: str = Field(min_length=5, max_length=1000)
    sample_note: str = Field(min_length=5, max_length=800)
    policy_stage: Literal['不适用', '意图', '预算', '实施', '效果评估'] = '不适用'


class MaterialBatch(StrictModel):
    materials: list[MaterialExtraction] = Field(max_length=2)


class SettingsInput(StrictModel):
    model_base_url: str = Field(default='https://api.openai.com/v1', max_length=300)
    model: str = Field(default='', max_length=100)
    model_key: str | None = Field(default=None, max_length=1000)
    fred_key: str | None = Field(default=None, max_length=1000)
    tavily_key: str | None = Field(default=None, max_length=1000)
    tushare_key: str | None = Field(default=None, max_length=1000)
    trust_proxy: bool = False

    @field_validator('model_base_url')
    @classmethod
    def base_url(cls, v):
        return safe_url(v, allow_local=True)


class ResearchInput(StrictModel):
    question: str = Field(min_length=5, max_length=1500)
    region: Literal['CHN', 'USA', 'WLD'] = 'CHN'
    sector: str = Field(default='宏观', max_length=60)
    horizon: Literal['3—6个月', '6—12个月', '1—3年', '3—5年'] = '1—3年'
    mode: Literal['brief', 'ai'] = 'brief'
    consent: bool = False


class Claim(StrictModel):
    text: str = Field(min_length=1, max_length=3000)
    nature: Literal['事实', '观点', '假设']
    refs: list[str] = Field(min_length=1, max_length=30)


class Scenario(StrictModel):
    name: str = Field(min_length=1, max_length=100)
    assumptions: str = Field(min_length=1, max_length=3000)
    triggers: str = Field(min_length=1, max_length=3000)


class AIReport(StrictModel):
    summary: str = Field(min_length=1, max_length=8000)
    claims: list[Claim] = Field(min_length=1, max_length=30)
    mechanism: list[str] = Field(min_length=1, max_length=15)
    scenarios: list[Scenario] = Field(min_length=2, max_length=4)
    invalidation: list[str] = Field(min_length=1, max_length=20)
    missing: list[str] = Field(min_length=1, max_length=20)
