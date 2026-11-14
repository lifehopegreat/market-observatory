import { ArrowRight, BookOpen, CheckCircle2, Scale } from 'lucide-react';
import { External, PageHeading } from './ui';
const principles = [
  ['历史是坐标，不是命运', '先看多年走势与统计口径，再判断当期变化。年度数据用于长期结构，月季数据用于近期验证，不把采集日当成观察期。'],
  ['政策是传导起点，不是必然结果', '区分意图、预算、实施和效果。追踪政策如何经过融资、投资、订单、就业和收入，最终影响实际需求。'],
  ['解释必须有证据，也允许未知', '事实、观点、假设分开存储。每条判断引用已保存的材料，报告保留生成时快照；模型无法补造缺失的样本、数据和因果关系。'],
  ['公众意愿，要与实际行为对照', '社区评论可帮助发现问题，不能直接推断民意比例。优先检查调查抽样和样本范围，再比较意愿、购买能力与实际消费。'],
  ['不把一切压成一个神秘分数', '资料覆盖不等于结论置信度；企业股价不等于产业景气；政策数量不等于支持力度。用可解释的维度与反证替代未经验证的综合预测。'],
  ['数值由代码计算，结论由人复核', '图表保留缺失、单位与变换公式。统计拟合不是预测，相关性不是因果。模型用于提出解释与条件情景，不能代替经济识别和现实验证。']
];
const refs = [
  ['国家统计局：同比与环比', '季节因素、增长率与可比口径', 'https://www.stats.gov.cn/zs/tjws/tjbk/202301/t20230101_1912960.html'],
  ['国家统计局：统计数据修订', '历史数据为什么会变化', 'https://www.stats.gov.cn/zt_18555/zthd/sjtjr/d12kfr/tjzsqzs/202302/t20230216_1908895.html'],
  ['世界银行 Indicators API', '可追溯的跨国年度序列', 'https://datahelpdesk.worldbank.org/knowledgebase/articles/898581-api-basic-call-structures'],
  ['FRED / ALFRED API', '观察日期与数据 vintage', 'https://fred.stlouisfed.org/docs/api/fred/series_observations.html'],
  ['FinRobot', '参考确定性计算与叙述分离', 'https://github.com/AI4Finance-Foundation/FinRobot'],
  ['OpenBB', '参考数据 provider 与元信息组织', 'https://github.com/openbq-org/OpenBB'],
  ['MACRO', '参考宏观周期视图，未沿用其评分', 'https://github.com/NotWizard/MACRO'],
  ['社区实践讨论', '仅作产品问题线索：单位、修订、溯源', 'https://www.reddit.com/r/mcp/comments/1xt12o1/how_are_you_getting_economic_data_cpi_rates_fx/']
];
export default function Method() {
  return <><PageHeading kicker="研究章程 / 方法与边界" title="不是预测一切，而是理解变化。" description="经济学提供框架，材料提供证据，现实检验判断。这三者不能相互替代。"/>
    <div className="method-hero"><Scale size={31} strokeWidth={1.1}/><blockquote>增长与价格、供给与需求、约束与预期，<br/>共同构成我们观察市场的坐标。</blockquote><p>官方统计 → 历史基线<ArrowRight size={14}/>政策与企业 → 传导验证<ArrowRight size={14}/>居民意愿与行为 → 需求检验</p></div>
    <div className="principle-grid">{principles.map(([title, text], i) => <article key={title} className="panel principle"><span className="principle-index">0{i + 1}</span><h2>{title}</h2><p>{text}</p></article>)}</div>
    <section className="panel methodology-limits"><h2><CheckCircle2 size={20}/>这套工作台的真实能力边界</h2><ul><li>世界银行数据提供历史结构，不是官方月度实时统计；ILO 失业率模型估计与中国调查失业率不同。</li><li>FRED 当前修订版与应用首次采集之后的快照可追溯，不声称重建采集之前的全部历史 vintage。</li><li>搜索材料需人工核验。政策、财报、业内和民意的信息覆盖由实际录入决定，不显示虚构的“全网覆盖率”。</li><li>行业标签可扩展，细分行业需补入对应数据；股票 OHLC 只是交易行情，不直接代替行业供需与盈利。</li><li>当前是本地单用户工具，仅监听回环地址。不要直接暴露到公网；云部署需要另行加入账户、授权和运维。</li></ul></section>
    <section className="panel reference-section"><div className="section-label"><h2>研究与实现参考</h2><BookOpen size={17}/></div>{refs.map(([name, text, url]) => <div key={url}><External href={url}>{name}</External><span>{text}</span></div>)}<p className="caption">开源项目仅借鉴方法与交互，不据此声称经济预测经过验证。完整计划含两轮审查记录。</p></section>
  </>;
}
