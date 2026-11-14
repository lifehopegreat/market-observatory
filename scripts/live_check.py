"""Actual provider smoke check; --ai sends locally saved research data to the configured model."""
import argparse
import asyncio
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend import store
from backend.app import research
from backend.models import ResearchInput
from backend.providers import worldbank


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ai', action='store_true', help='Call the configured model, with its API cost and data transfer')
    parser.add_argument('--refresh', action='store_true', help='Refresh China WDI historical series')
    args = parser.parse_args()
    store.init()
    if args.refresh:
        data = await worldbank('CHN')
        print(f'WDI: {len(data)} datasets, {sum(len(d["points"]) for d in data)} observations')
    if args.ai:
        r = await research(ResearchInput(question='中国居民消费与产业结构的长期变化：当前历史数据支持哪些观察，还缺少哪些政策、企业与公众证据？',
                                        region='CHN', sector='宏观', horizon='1—3年', mode='ai', consent=True))
        print(f'Live model report saved: {r["id"]}; claims={len(r["body"]["claims"])}; scenarios={len(r["body"]["scenarios"])}; all citation IDs validated')
    print('No credentials returned or printed.')


if __name__ == '__main__':
    asyncio.run(main())
