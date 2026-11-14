# 观澜 · 宏观与产业研究工作台

## 目标与边界
以经济学的增长、价格、信用、就业、收入、供需与预期框架组织研究。历史统计是观察经济的证据而非决定未来的规律；政策提供条件性方向，不保证执行结果。政策、财报、机构预期、行业信息、民生、公众意愿交叉验证，支持从中国宏观下钻产业。默认本地单用户，不接交易、不做收益承诺、不虚构数据或 AI 结论。

## 研究参考
- 国家统计局同比/环比解释：https://www.stats.gov.cn/zs/tjws/tjbk/202301/t20230101_1912960.html 。区分同比、环比、季调，避免对增长率再算增长率。
- 国家统计局数据修订说明：https://www.stats.gov.cn/zt_18555/zthd/sjtjr/d12kfr/tjzsqzs/202302/t20230216_1908895.html 。保留抓取快照和来源更新日期，不能把当前修订值冒充历史已知值。
- 世行 API：https://datahelpdesk.worldbank.org/knowledgebase/articles/898581-api-basic-call-structures 。免密钥长序列、国家比较；年频并非实时数据。
- FRED/ALFRED：https://fred.stlouisfed.org/docs/api/fred/series_observations.html 。配置 API 后接入月/季/日序列，保留观察期与 vintage；不得伪造发布日期。
- AKShare：https://github.com/akfamily/akshare 。中国财经与宏观接口参考；接口库不等于数据全部来自官方。
- MACRO：https://github.com/NotWizard/MACRO 。参考宏观视图和周期拆解，不复用未经验证的综合分数。
- OpenBB：https://github.com/openbq-org/OpenBB 。参考 provider 与来源元数据分离。
- FinRobot：https://github.com/AI4Finance-Foundation/FinRobot 。参考确定性计算与 LLM 叙述分离、数字溯源。
- GPT Researcher：https://github.com/assafelovic/gpt-researcher 。参考检索、证据整合、报告流程，不把文本汇总等同于经济预测。
- 用户讨论：https://www.reddit.com/r/mcp/comments/1xt12o1/how_are_you_getting_economic_data_cpi_rates_fx/ 。仅作为产品问题线索：单位误读、数据修订、无 API 的官方来源；不作经济事实依据。
- 图表：https://github.com/apache/echarts 。交互缩放、框选、数据表、K线、导出；K线仅接受真实 OHLC，饼图仅接受同一时点互斥非负构成数据。
- Tavily：https://docs.tavily.com/documentation/api-reference/endpoint/search 。用户配置搜索 key 后检索材料，搜索摘要默认待核验，不自动升级为事实。
- Tushare：https://tushare.pro/document/2?doc_id=27 。配置 token 后拉取真实未复权 OHLC；股票行情不是产业基本面。
- DeepSeek 官方 Search：https://api-docs.deepseek.com/guides/search/ 。支持配置官方模型与搜索服务；模型 ID 以服务商返回为准。

## 实施顺序
1. 明确数据契约、研究方法和视觉方向（本文件、DESIGN.md、README.md）。
2. FastAPI + SQLite 本地后端：数据集、历次快照、证据、研究报告、API 配置。密钥 Windows DPAPI 加密，接口不回显；同源写入防护与回环部署。
3. 接入免 key 世行长序列、FRED、Tushare；提供严格 CSV 导入补充官方月频/行业/调查/财报数据。保留缺失、单位、频率、来源、抓取时间、发布日期是否已知。
4. React + TypeScript + ECharts：宏观总览、行业研究、图表实验室、七维证据库、研究室、数据与 API 设置。Swiss 单一锚点，石墨/银白/香槟金，日夜模式、响应式与键盘访问。
5. 图表工具：折线、柱、面积、K线、饼图；按数据语义开放；区间缩放、十字线、均线、趋势线、区间统计、原始值/基期100/同比、表格、CSV 与 PNG 导出。拒绝跨单位误比较和增长率重复同比。
6. 证据闭环：手动录入 + Tavily 检索，事实/观点/假设、来源等级、政策阶段、行业、样本说明、发布时间、反证。AI 基于已存证据与数据生成带引用的结构化研究，持久化原始上下文；缺 key 明示，不模拟。
7. 实际采集可达数据；单元/API/浏览器测试；桌面日夜与手机截图复核；记录剩余依赖和风险。

## 第一轮审查：研究完整性与图表真实性
- [已修正] “政策决定未来”改为政策意图→预算→实施→效果，区分承诺与落实。
- [已修正] 区分观察期、来源更新、抓取日、发布日期；未知发布日期明确为空；快照从首次采集开始，不声称重建此前已知信息。
- [已修正] 不用新闻热度/评论数替代支持率，不给无代表性样本生成民意百分比；证据录入包含样本说明。
- [已修正] 财报仅代表覆盖企业，机构判断是观点；行业数据与市场交易行情分别标记。
- [已修正] 不强制 K线/饼图，不补造 OHLC，不把负值或连续年份强作构成比例；柱状基线为零，缺失断线。
- [已修正] 先验证数据与口径，再做结论；输出反证、缺失证据与情景条件，而非未经校准的置信概率。

## 第二轮审查：工程、安全与验收
- [已修正] UI/后端/导入验证/图表转换/报告引用共用明确契约并覆盖测试；先落地持久化与真实请求，不能只交静态看板。
- [已修正] API key 不进入前端存储、日志、导出或版本库；Windows 加密，非 Windows 使用环境变量；配置外部模型明确研究材料将发送服务商。
- [已修正] 外部数据失败保留上次成功快照、显示错误和时间，不把过期缓存标成实时；请求有超时、限流与有界并发。
- [已修正] URL 限定 HTTPS（本机模型允许 loopback HTTP），证据链接仅存储不主动抓取；模型端点重定向关闭，不对外提供任意 URL 代理。
- [已修正] CSV 数值/日期/重复键/OHLC/构成一致性严格检查，原子写入，导出防公式注入。
- [已修正] 暂不加入多用户、云部署、交易、社媒登录爬虫、消息推送：不属于当前完整研究闭环，避免引入额外权限与成本。
- [已修正] 验收含持久化、缺 key、无数据、失败恢复、图表切换约束、两种主题、窄屏、控制台与构建。
