# Speech-to-Scene 项目分析与修订建议

> 分析对象：`docs/planning/Speech-to-Scene_Phase1_Demo_Execution_Plan.md`
> 分析日期：2026-07-13
> 当前结论：方向成立，建议先修订设计，再进入 M0；本文件不代表法律意见。

## 1. 总体判断

这是一个边界清楚、适合个人开发者推进、也适合开源协作的项目。第一阶段选择“文稿到可审核素材清单”，而不是直接生成视频，是正确的产品切入点：它能产生独立价值，也为后续时间轴、渲染和剪辑保留稳定协议。

原计划大约 80% 可以直接保留，尤其是以下部分：

- 本地优先、人在回路；
- `project.s2s.json` 作为跨阶段协议；
- Domain / Application / Infrastructure / Interface 分层；
- Zod 作为持久化数据的单一事实来源；
- 原子写入、网络缓存、Fixture 测试；
- 默认只监听 `127.0.0.1`；
- 不自动下载第三方素材；
- 按 M0～M6 小步交付。

但在开始 M0 前，建议先解决四个设计问题：

1. 将 Claude 改为通用 LLM Provider，DeepSeek 作为一等实现。
2. 将“免费素材”改造成可计算、可审核的许可证模型。
3. 不让 LLM 直接承担不可靠的字符偏移定位。
4. 将本地审核服务补充 Origin、CSRF、DNS rebinding 等安全边界。

## 2. 产品范围建议

### 2.1 V0.1 继续保持单一素材 Provider

“整理尽可能完整的素材站目录”和“首版聚合所有素材站”是两件不同的事。

建议：

- V0.1 运行时只实现 `PexelsProvider + FixtureProvider + LocalAsset`；
- 同期建立独立的素材源注册表和维护型 Skill；
- V0.2 再增加 Openverse/Wikimedia 等开放许可 Provider；
- 不在 V0.1 同时处理十几个不同 API、许可规则和归属格式。

这样既保留原计划的开发边界，也满足未来扩展和版权治理需求。

### 2.2 第一阶段真正的核心护城河

项目的差异化不应是“接了多少图库”，而应是：

- 识别哪些话不需要配图；
- 将抽象表达转换为可检索的具体画面；
- 对素材许可、来源和人工决定形成审计链；
- 让项目数据能被后续剪辑流程稳定消费。

因此，场景规划质量、视觉节奏和版权元数据应优先于 Provider 数量。

## 3. DeepSeek 接入修订

### 3.1 不再把 Anthropic SDK 写进核心设计

现有文档把“LLM”与“Claude Structured Outputs”绑定得过紧。建议改成：

```ts
export interface ScriptPlanner {
  readonly providerId: string;
  plan(input: PlanScriptInput): Promise<PlanScriptOutput>;
}
```

基础实现：

```text
FixtureScriptPlanner
DeepSeekScriptPlanner
AnthropicScriptPlanner（可选，不阻塞 V0.1）
```

DeepSeek 官方 API 当前提供 OpenAI/Anthropic 兼容格式，但模型名和能力会变化。因此：

- 模型名必须来自环境变量；
- Base URL 必须可配置；
- 不把某个具体 DeepSeek 模型名写入 Domain 或 Schema 枚举；
- SDK 兼容不等于所有 Structured Output 行为完全相同；
- 无论 Provider 是否宣称支持 JSON Schema，最终都必须经过 Zod 和业务规则验证。

建议环境变量：

```dotenv
S2S_PLANNER_PROVIDER=deepseek

DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=

ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=

PEXELS_API_KEY=
```

### 3.2 Provider 能力协商

不同模型提供商对 JSON Output、JSON Schema、Tool Calling、思考模式和 token 统计的支持不同。建议基础设施层暴露能力，而不是让 Application 猜测：

```ts
type PlannerCapabilities = {
  jsonMode: boolean;
  strictJsonSchema: boolean;
  toolCalling: boolean;
  usageMetrics: boolean;
};
```

输出策略优先级：

1. 严格 JSON Schema；
2. Tool/Function Calling；
3. JSON mode；
4. 纯文本 JSON 提取，仅作为兼容兜底。

所有路径都执行：解析 → Zod 校验 → 业务校验 → 最多一次修复 → 原子写入。

### 3.3 GenerationMeta 建议

不建议把 Provider 固定成枚举：

```ts
type GenerationMeta = {
  plannerProvider: string;
  apiProtocol?: "openai-compatible" | "anthropic" | "fixture";
  model?: string;
  promptVersion: string;
  schemaVersion: string;
  generatedAt: string;
};
```

只记录定位问题所需的信息，不记录 Key、完整请求、完整文稿或隐藏推理内容。

## 4. 场景定位的关键技术风险

原方案让 LLM 返回 `sourceStart` 和 `sourceEnd`。这是高风险点：模型对 Unicode 字符偏移不稳定，而 JavaScript 字符串下标又按 UTF-16 code unit 计算，中文标点、Emoji、组合字符都可能导致偏差。

推荐流程：

1. 程序先把原文确定性切成带 ID 的块，例如段落、标题和列表项；
2. LLM 返回连续的 `sourceBlockIds`、首尾短引文和场景语义；
3. 程序在本地解析为精确 `sourceRange`；
4. 若引文不唯一或块不连续，拒绝结果并要求修复；
5. 最终持久化时仍保留 `sourceRange`，便于第二阶段使用。

建议 Planner 输出：

```ts
type PlannedSceneAnchor = {
  sourceBlockIds: string[];
  startQuote: string;
  endQuote: string;
};
```

这比要求模型数中文字符可靠得多，也更容易做回归测试。

## 5. 素材版权模型

### 5.1 必须区分的概念

- 开源软件：通常指代码许可证，不等于素材许可证。
- 开放许可素材：允许按许可证复用，可能要求署名或相同方式共享。
- 免费下载：价格为零，不代表可商用、可修改或可再分发。
- Royalty-free：通常表示无需按次付费，不代表无版权。
- Public Domain / CC0：版权限制最少，但仍可能存在商标、肖像、隐私、文物所在地规则等问题。

项目文案不要使用“无版权素材”作为笼统描述，建议使用“许可信息明确的可复用素材”。

### 5.2 默认许可策略

针对可能变现的口播视频，建议默认策略如下：

| 许可证/状态              | 默认处理             | 备注                                   |
| ------------------------ | -------------------- | -------------------------------------- |
| CC0 / Public Domain Mark | 允许                 | 仍检查人物、商标和第三方元素           |
| CC BY                    | 允许                 | 自动生成署名文本                       |
| CC BY-SA                 | 警告后允许           | 成片/改编物的适用边界需用户确认        |
| 平台自有免费许可         | 按 Provider 规则允许 | 例如 Pexels/Unsplash，不能笼统称为开源 |
| CC BY-NC / NC-SA         | 默认拒绝商用项目     | “非商业”边界不适合自动推断             |
| CC BY-ND / ND            | 默认拒绝编辑型视频   | 裁剪、字幕叠加等是否构成改编存在风险   |
| Editorial use only       | 默认拒绝普通商业视频 | 只在明确编辑用途工作流中开放           |
| No known copyright       | 警告                 | 不等于确定属于公有领域                 |
| 未知/无声明              | 拒绝                 | 不进入默认候选池                       |

### 5.3 AssetCandidate 必须扩展

当前 `AssetCandidate` 只保存平台归属，不足以支撑版权审计。建议新增：

```ts
type AssetRights = {
  status: "public_domain" | "open_license" | "platform_license" | "editorial_only" | "unknown";
  licenseCode?: string;
  licenseName?: string;
  licenseUrl?: string;
  attributionRequired: boolean;
  attributionText?: string;
  commercialUse: "allowed" | "disallowed" | "unclear";
  derivatives: "allowed" | "disallowed" | "share_alike" | "unclear";
  restrictions: string[];
  rightsStatementUrl?: string;
  verifiedAt: string;
};
```

候选还应保存：

- `providerTermsUrl`；
- `sourcePageUrl`；
- `creator.name` 与 `creator.profileUrl`；
- `retrievedAt`；
- 原始许可字段的最小快照；
- Provider 规则版本。

用户导入本地文件时，应把来源和许可快照一并复制到 `LocalAsset` 或独立 `AssetRecord` 中。否则远程候选失效后无法审计。

### 5.4 许可不是一次性常量

平台条款和单个素材状态可能变化。建议：

- 每个 Provider 保存 `termsUrl` 和 `termsCheckedAt`；
- 每个素材保存检索时许可快照；
- UI 显示“检索时许可”，并提供回到原页面复核；
- 发布文档明确：工具提供记录和过滤，不替用户做法律结论。

## 6. 素材网站注册表设计

“全网最详细”无法形成永远完整的静态名单。更可靠的做法是建立可维护、可验证、可扩展的注册表。

建议文件：

```text
catalog/
├── sources.yaml
├── licenses.yaml
└── schema.json
```

每个站点至少记录：

```yaml
id: openverse
name: Openverse
homepage: https://openverse.org/
mediaTypes: [image, audio]
access: api
apiDocs: https://api.openverse.org/v1/
apiKeyRequired: false
licenseModel: per-item
commercialFilter: true
derivativeFilter: true
attributionMetadata: true
autoDownloadPolicy: review-required
termsUrl: https://docs.openverse.org/terms_of_service.html
lastVerifiedAt: 2026-07-13
riskNotes:
  - Aggregator metadata may be inaccurate; verify at the original source.
```

### 6.1 第一梯队：适合后续开发 Provider

| 来源                     | 类型                   |          API | 许可特征                                                | 建议                       |
| ------------------------ | ---------------------- | -----------: | ------------------------------------------------------- | -------------------------- |
| Pexels                   | 图片、视频             |           有 | 平台免费许可；API 要求显著链接，尽可能署名              | V0.1 首发                  |
| Openverse                | 图片、音频             |           有 | 聚合 CC/公有领域；必须逐条复核                          | V0.2 首选聚合层            |
| Wikimedia Commons        | 图片、视频、音频       |           有 | 单条素材许可不同，多为自由许可/公有领域                 | V0.2，严格解析许可模板     |
| Pixabay                  | 图片、插画、视频、音频 |           有 | 平台自有许可与 API 条款                                 | 候选，先完成条款审计       |
| Unsplash                 | 图片                   |           有 | 平台许可；API 展示时强制平台和摄影师署名、链接、hotlink | 候选，不宜照搬 Pexels 逻辑 |
| Smithsonian Open Access  | 图片、3D、数据         |           有 | 仅带 CC0 标记的资产默认安全                             | 文化/历史垂类优先          |
| The Met Open Access      | 艺术图片               |           有 | OA 标记素材 CC0                                         | 艺术/历史垂类优先          |
| Art Institute of Chicago | 艺术图片               |     有、IIIF | 可过滤 `is_public_domain`                               | 艺术垂类优先               |
| Rijksmuseum              | 艺术图片、数据         |           有 | Public Domain、CC0、CC BY 或受限，逐条判断              | 艺术垂类候选               |
| Library of Congress      | 图片、地图、音视频     | 有、无需 Key | 仅 Free to Use and Reuse 集合或明确 rights statement    | 历史/档案垂类              |
| DPLA                     | 文化遗产聚合           |           有 | 需按 RightsStatements/CC 过滤并回源                     | 美国历史垂类               |
| National Gallery of Art  | 艺术图片               |     数据/API | 公有领域作品开放下载                                    | 艺术垂类                   |
| NASA                     | 图片、视频、音频       |    有/多入口 | 多数美国政府作品可用，但第三方标注、Logo、肖像需排除    | 科普垂类                   |

### 6.2 第二梯队：可列入人工素材目录，暂不做 Provider

| 来源                             | 类型                   | 主要注意事项                                              |
| -------------------------------- | ---------------------- | --------------------------------------------------------- |
| Europeana                        | 文化遗产聚合           | 许可状态很多，必须按单项 rights URI 过滤                  |
| Internet Archive                 | 视频、音频、图片、文本 | 上传者自行标注，权利质量不一，必须逐项核验                |
| Coverr                           | 视频                   | API 要求来源标识，API/素材商业使用边界需按最新条款复核    |
| Mixkit                           | 视频、音乐、音效、模板 | 不同素材类型甚至同类素材可能采用 Free/Restricted 两套许可 |
| Freesound                        | 音效                   | CC0、CC BY、CC BY-NC 混合，必须过滤 NC 并保存署名         |
| YouTube Audio Library            | 音乐、音效             | 适合 YouTube；部分 CC 曲目要求描述区署名，跨平台需复核    |
| Free Music Archive               | 音乐                   | 单曲许可证不同，API/维护状态需复核                        |
| ccMixter                         | 音乐、采样             | 单曲许可不同，需处理 BY/NC 等条件                         |
| Musopen                          | 古典音乐、乐谱         | 作品公版不代表录音公版，逐条核对录音许可                  |
| Internet Archive Community Audio | 音频                   | 与 Archive 相同，不能信任“可下载”等于“可商用”             |
| British Library collections      | 历史音频、图片         | 可访问不等于开放复用，以单项 rights statement 为准        |
| NYPL Digital Collections         | 历史图片               | 仅明确 Public Domain 项目默认进入候选                     |
| Wellcome Collection              | 医学、历史图片         | 多种 CC/rights 状态，逐项过滤                             |
| Biodiversity Heritage Library    | 自然历史图片           | 多机构、多许可证，保留来源链                              |

### 6.3 默认排除或仅提供外链

- Google 图片、百度图片、Bing 图片普通搜索结果；
- Pinterest、微博、小红书、抖音、Bilibili 等用户内容平台；
- YouTube 普通视频搜索；
- 标称“no copyright”但没有具体许可证和权利人的资源站；
- 需要爬虫绕过登录、限流、robots 或下载保护的网站；
- 许可未知、只允许个人使用、只允许编辑用途的素材；
- 把第三方站点内容二次聚合但不提供原始来源和许可证的站点。

这些来源可以在人工研究中打开，但不应进入自动候选池。

## 7. 素材目录 Skill 建议

Skill 的职责不应是“自动判断一定合法”，而应是：

1. 根据媒体类型、主题、商用需求和是否允许改编筛选来源；
2. 优先使用官方 API 和明确许可过滤器；
3. 生成每条素材的署名与许可清单；
4. 标记必须人工复核的风险；
5. 定期检查站点条款、API 可用性和许可变化；
6. 更新 `catalog/sources.yaml`，保留验证日期和证据链接。

建议 Skill 输出固定包含：

- 推荐来源及原因；
- 媒体类型；
- API/人工访问方式；
- 是否需要 Key；
- 可商用、可修改、署名、相同方式共享状态；
- 官方许可证与 API 条款链接；
- 最近核验日期；
- 风险与人工复核项。

此 Skill 应在 M6 创建，但注册表 Schema 应在 M1 确定，避免后期返工。

## 8. 本地审核服务安全补充

只绑定 `127.0.0.1` 仍不足以覆盖浏览器侧攻击。建议增加：

- 严格校验 `Host`，只允许 loopback 和实际监听端口；
- 严格校验 `Origin`，写请求拒绝第三方网页来源；
- 启动时生成随机会话 token，写请求携带；
- 设置 CSP，限制脚本、frame、connect 和媒体来源；
- 禁止 CORS 通配符；
- 防止 DNS rebinding；
- 文件导入只接收 multipart 内容，不接受客户端绝对路径；
- 以 magic bytes 为主、MIME 和扩展名为辅校验文件；
- 限制请求体、单文件大小、文件数量和超时；
- 防止符号链接、junction、硬链接和 TOCTOU 越界；
- `sourcePageUrl` 仅允许 HTTPS，并按 Provider 域名白名单打开；
- 默认不代理任意远程 URL，避免 SSRF；
- 远程预览会暴露用户 IP，应在隐私文档中说明。

## 9. 数据与状态模型改进

### 9.1 状态只推导，不重复持久化

原文这一原则正确，但当前 `review.status` 与其他字段可能产生冲突。建议：

- 持久化用户意图：`reviewDecision`；
- 根据候选、选择和本地文件推导运行状态；
- Validator 检查互斥字段；
- 状态迁移集中在 Domain 函数中。

### 9.2 搜索结果与项目文件的边界

把所有候选完整写入 `project.s2s.json` 会快速膨胀。建议：

- 搜索原始响应和完整候选集放 `cache/search/`；
- 项目文件只保留当前展示候选的规范化快照或缓存引用；
- 已选择候选必须保存不可变审计快照；
- 清理缓存不能破坏已完成项目的可读性。

### 9.3 Schema 兼容策略

在 `0.1` 发布前字段仍可调整；一旦公开发布：

- 使用 SemVer 风格的 Schema 版本策略；
- 明确“新增可选字段”和“破坏性字段”的处理；
- fixture 覆盖旧版本读取；
- 未知新版本拒绝写入，但可提供只读错误诊断。

## 10. 开源发布建议

### 10.1 许可证

MIT 适合作为默认代码许可证，但它只覆盖仓库代码，不自动覆盖：

- 第三方图片、视频、音频；
- 示例项目引用的远程素材；
- 项目名称、Logo 和商标；
- 用户生成内容；
- 第三方依赖。

建议仓库增加：

```text
LICENSE
docs/governance/THIRD_PARTY_NOTICES.md
docs/governance/SECURITY.md
docs/governance/CONTRIBUTING.md
docs/governance/CODE_OF_CONDUCT.md
docs/ASSET_LICENSING.md
docs/PRIVACY.md
```

示例项目优先使用自制素材、CC0 或明确 Public Domain 素材，并随示例提交机器可读的 attribution 清单。

### 10.2 GitHub 发布卫生

- `.env*` 默认忽略，只放 `.env.example`；
- 缓存、用户项目和下载素材不入 Git；
- Fixtures 必须脱敏并注明来源和许可；
- Dependabot/Renovate 只提 PR，不自动合并破坏性升级；
- CI 至少覆盖 Windows、Linux、macOS 的路径逻辑；
- 发布包通过 `npm pack --dry-run` 检查内容；
- 增加 secret scanning 和依赖审计；
- README 明确项目不提供法律保证。

## 11. 对现有里程碑的修订

### M0：工程骨架

保留原范围，另加：

- Node 版本使用 `engines` 和 CI matrix 声明，不依赖开发机默认版本；
- 建立 `docs/ASSET_LICENSING.md` 空框架；
- 建立 `docs/governance/SECURITY.md`；
- CI 覆盖三平台的最小检查。

### M1：Schema 与 Repository

在原任务上增加：

- `AssetRights`、Provider 条款快照、检索时间；
- `plannerProvider: string`；
- 选中素材的审计快照；
- 确定素材源注册表 Schema；
- 测试符号链接/junction 路径边界。

### M2：通用 Planner 与 DeepSeek

将“Claude Script Planner”改为“Script Planner Providers”：

- 先完成 Fixture；
- 再实现 DeepSeek；
- Anthropic 作为可选 Provider；
- 加入能力协商；
- 使用块 ID + 引文锚点解析 `sourceRange`；
- 所有 Provider 共用同一套 Zod 和业务验证。

### M3：Pexels Provider

继续只做 Pexels，但实现通用 rights 映射和 Provider policy；为未来 Openverse/Wikimedia 留接口，不实现聚合 UI。

### M4：Review Server

加入 Host/Origin/CSRF/DNS rebinding/SSRF/链接与文件系统边界测试。

### M5：Review Board

除原交互外，必须展示：

- 许可证名称和链接；
- 作者与来源；
- 可商用/可修改状态；
- 必须署名的复制按钮；
- 未知或受限素材的醒目警告；
- 发布前 attribution 清单预览。

### M6：发布与维护型 Skill

- 创建素材源目录 Skill；
- 首批注册表至少覆盖本文件列出的来源；
- 对首批 Tier 1 来源逐一链接官方条款并记录验证日期；
- 生成 `ATTRIBUTIONS.md` 或项目级 JSON/Markdown 清单；
- 完成 GitHub 开源文件和干净环境发布验证。

## 12. 建议的开发顺序

1. 先把原计划复制到 `docs/PHASE1_DEMO_PLAN.md`，根据本分析修订术语和里程碑。
2. 冻结 `project.s2s.json` V0.1 Schema 草案，尤其是 rights、审计快照和 Planner metadata。
3. 执行 M0，只建工程骨架，不实现业务。
4. 执行 M1，先用 fixtures 验证协议和原子写入。
5. 执行 M2，Fixture 先行，再接 DeepSeek；不要先接真实网络写测试。
6. 执行 M3～M5，保持 Pexels 单 Provider。
7. 执行 M6，完成素材注册表、Skill、开源文档与发布检查。
8. V0.2 再评估 Openverse/Wikimedia Provider 和多源排序。

## 13. 本轮结论

可以开发，但不建议直接照原文进入 M0。最优先的文档变更是：

- 全文将“Claude”改为“可插拔 Planner Provider”，DeepSeek 为首选真实实现；
- 将 `GenerationMeta.plannerProvider` 和素材 Provider 从封闭枚举改为可扩展标识；
- 新增 `AssetRights` 与许可快照；
- 将 LLM 字符偏移改为本地块锚点解析；
- 把素材网站“大名单”做成可维护注册表，不把它变成 V0.1 多平台开发范围；
- 补齐本地 Web 服务浏览器安全；
- 明确代码开源与素材许可是两套独立规则。

完成这些修订后，M0～M6 的总体结构仍然成立，且后续接入 DeepSeek、Openverse、Wikimedia 或其他 Provider 时不需要推翻核心协议。

## 14. 本轮核对的官方资料

- [DeepSeek API 文档](https://api-docs.deepseek.com/)
- [Pexels API 文档](https://www.pexels.com/api/documentation/)
- [Pexels License](https://www.pexels.com/legal-pages/license/)
- [Openverse API/项目文档](https://docs.openverse.org/api/reference/made_with_ov.html)
- [Openverse Terms of Service](https://docs.openverse.org/terms_of_service.html)
- [Wikimedia Commons 站外复用指南](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia/en)
- [Unsplash API 文档](https://unsplash.com/documentation)
- [Unsplash API Terms](https://unsplash.com/api-terms)
- [Smithsonian Open Access](https://www.si.edu/openaccess)
- [The Met Open Access](https://www.metmuseum.org/hubs/open-access)
- [Art Institute of Chicago API](https://api.artic.edu/docs/)
- [Rijksmuseum Data Services](https://data.rijksmuseum.nl/)
- [Library of Congress API](https://www.loc.gov/apis/json-and-yaml/)
- [Library of Congress Free to Use and Reuse](https://www.loc.gov/free-to-use/)
- [DPLA Rights Categories](https://dp.la/about/rights-categories)
- [National Gallery of Art Open Access](https://www.nga.gov/artworks/free-images-and-open-access)
- [NASA Images and Media Usage Guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/)
- [Freesound API](https://freesound.org/docs/api/)
- [Mixkit License](https://mixkit.co/license/)
- [Coverr API](https://api.coverr.co/docs)
- [YouTube Audio Library 帮助](https://support.google.com/youtube/answer/3376882)
