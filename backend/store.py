import base64
import ctypes
import hashlib
import json
import os
from pathlib import Path
import sqlite3
from datetime import datetime, timezone
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(os.environ.get('OBSERVATORY_DATA_DIR', ROOT / 'data'))
DB = DATA / 'observatory.sqlite3'
DIMENSIONS = ['官方数据', '政策', '财报', '市场预期', '业内信息', '民生', '公众意愿']


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


class Connection(sqlite3.Connection):
    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()


def connect():
    DATA.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB, timeout=15, factory=Connection)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA journal_mode=WAL')
    c.execute('PRAGMA foreign_keys=ON')
    return c


def init():
    with connect() as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS datasets(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS snapshots(id INTEGER PRIMARY KEY, dataset_id TEXT NOT NULL,
          fetched_at TEXT NOT NULL, digest TEXT NOT NULL, payload TEXT NOT NULL,
          UNIQUE(dataset_id,digest));
        CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS config(id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sync_log(id INTEGER PRIMARY KEY, at TEXT NOT NULL, provider TEXT NOT NULL,
          success INTEGER NOT NULL, message TEXT NOT NULL);
        ''')


def dumps(obj):
    return json.dumps(obj, ensure_ascii=False, allow_nan=False, separators=(',', ':'))


def listing(table):
    assert table in ('datasets', 'evidence', 'reports')
    with connect() as c:
        return [json.loads(r['payload']) for r in c.execute(f'SELECT payload FROM {table} ORDER BY rowid DESC')]


def get(table, id):
    assert table in ('datasets', 'evidence', 'reports')
    with connect() as c:
        row = c.execute(f'SELECT payload FROM {table} WHERE id=?', (id,)).fetchone()
    return json.loads(row['payload']) if row else None


def save(table, payload):
    assert table in ('evidence', 'reports')
    with connect() as c:
        c.execute(f'INSERT OR REPLACE INTO {table}(id,payload) VALUES(?,?)', (payload['id'], dumps(payload)))
    return payload


def save_datasets(datasets):
    # A provider refresh is one transaction; failures cannot publish partial series.
    with connect() as c:
        for d in datasets:
            content = {k: v for k, v in d.items() if k not in ('fetched_at', 'digest')}
            digest = hashlib.sha256(dumps(content).encode()).hexdigest()
            d = {**d, 'digest': digest}
            encoded = dumps(d)
            c.execute('INSERT OR IGNORE INTO snapshots(dataset_id,fetched_at,digest,payload) VALUES(?,?,?,?)',
                      (d['id'], d['fetched_at'], digest, encoded))
            c.execute('INSERT OR REPLACE INTO datasets(id,payload) VALUES(?,?)', (d['id'], encoded))


def sync_log(provider, success, message):
    with connect() as c:
        c.execute('INSERT INTO sync_log(at,provider,success,message) VALUES(?,?,?,?)', (now(), provider, success, message))


def protect(value, decrypt=False):
    if os.name != 'nt':
        raise ValueError('非 Windows 系统请用环境变量配置密钥，应用不保存明文密钥')
    from ctypes import wintypes

    class Blob(ctypes.Structure):
        _fields_ = [('cbData', wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_ubyte))]

    data = base64.b64decode(value) if decrypt else value.encode()
    buf = ctypes.create_string_buffer(data)
    source = Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_ubyte)))
    target = Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    if decrypt:
        ok = crypt.CryptUnprotectData(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target))
    else:
        ok = crypt.CryptProtectData(ctypes.byref(source), 'Guanlan', None, None, None, 1, ctypes.byref(target))
    if not ok:
        raise ValueError('系统密钥加密/解密失败，请在当前 Windows 用户下重新配置')
    try:
        out = ctypes.string_at(target.pbData, target.cbData)
        return out.decode() if decrypt else base64.b64encode(out).decode()
    finally:
        kernel.LocalFree(target.pbData)


ENV_KEYS = {'model_key': 'OBSERVATORY_MODEL_KEY', 'fred_key': 'FRED_API_KEY', 'tavily_key': 'TAVILY_API_KEY', 'tushare_key': 'TUSHARE_TOKEN'}


def settings(secret=False):
    with connect() as c:
        row = c.execute('SELECT payload FROM config WHERE id=1').fetchone()
    cfg = json.loads(row['payload']) if row else {'model_base_url': 'https://api.openai.com/v1', 'model': '', 'trust_proxy': False}
    for k, env in ENV_KEYS.items():
        token = os.environ.get(env)
        if secret:
            cfg[k] = token or (protect(cfg[k], True) if cfg.get(k) else '')
        else:
            cfg[k] = bool(token or cfg.get(k))
    cfg['key_storage'] = 'Windows DPAPI · 当前用户加密' if os.name == 'nt' else '仅环境变量'
    return cfg


def save_settings(values):
    with connect() as c:
        row = c.execute('SELECT payload FROM config WHERE id=1').fetchone()
        current = json.loads(row['payload']) if row else {}
        for k, v in values.items():
            if k in ENV_KEYS:
                if v is None:
                    continue
                if v == '':
                    current.pop(k, None)
                else:
                    current[k] = protect(v)
            else:
                current[k] = v
        c.execute('INSERT OR REPLACE INTO config(id,payload) VALUES(1,?)', (dumps(current),))
    return settings()


def uid(prefix):
    return f'{prefix}-{uuid4().hex[:12]}'
