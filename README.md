# Speech-to-Scene

Speech-to-Scene 是一个本地优先、人在回路中的口播视觉素材规划工具。

第一阶段目标是把 Markdown/TXT 口播稿转换成可审核的语义场景和素材候选清单：

```text
文稿 → 语义场景 → 搜索建议 → 素材候选 → 人工审核 → 本地素材关联
```

项目目前处于 `V0.1 / M0` 工程初始化阶段，尚未提供可用的文稿规划、素材搜索或审核页面。

## 当前范围

计划支持：

- Markdown/TXT 文稿；
- DeepSeek 优先的可插拔 LLM Planner；
- Pexels 素材候选；
- 本地审核页面；
- 手动下载与本地素材关联；
- 来源、许可和署名信息记录；
- 项目完整性检查。

第一阶段不包含视频渲染、ASR、时间轴、自动下载第三方素材、AI 生图、云端账户或数据库。

## 开发环境

- Node.js 24 LTS
- pnpm 11

```bash
corepack enable
pnpm install
pnpm check
pnpm s2s --help
```

环境变量请从 `.env.example` 开始配置。任何 API Key 都不得提交到 Git。

## 开发命令

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```

## 项目文档

- [第一阶段原始执行计划](./Speech-to-Scene_Phase1_Demo_Execution_Plan.md)
- [项目分析与修订建议](./PROJECT_ANALYSIS_AND_RECOMMENDATIONS.md)
- [项目 Schema](./docs/PROJECT_SCHEMA.md)
- [视觉语法](./docs/VISUAL_GRAMMAR.md)
- [素材许可策略](./docs/ASSET_LICENSING.md)
- [隐私说明](./docs/PRIVACY.md)

## 开源与素材许可

仓库代码采用 [MIT License](./LICENSE)。第三方图片、视频、音频及其许可证不因代码采用 MIT 而改变。项目只提供来源记录和许可辅助，不构成法律意见；使用者仍需在发布前核验具体素材页面、许可证、署名、肖像、商标和隐私要求。

## 状态

当前只完成 M0 工程骨架。后续按 M1～M6 小步实现，每个里程碑独立测试和验收。
