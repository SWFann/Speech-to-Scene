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
- **推荐使用 WSL/Linux 环境运行 `pnpm install`、`pnpm test`、`pnpm build`**

### 平台注意事项

- **不要在 Windows 和 WSL 之间共享同一个 `node_modules`**。
  项目依赖的 native binding（如 `@rolldown/binding-*`）是平台相关的，
  WSL 安装的是 `binding-linux-x64-gnu`，Windows 需要 `binding-win32-x64-msvc`。
  混用会导致 Vitest 等工具启动失败。
- 如果切换平台（例如从 Windows 切到 WSL，或反之），
  请先删除 `node_modules`，然后在新平台上重新执行 `pnpm install`。
  `pnpm-lock.yaml` 是跨平台的，不需要删除。
- Codex 当前 Windows sandbox 无法直接访问 WSL distro（如 Ubuntu2），
  因此 `pnpm test` 以 Claude 在 WSL/Ubuntu2 中的输出为准。
- 所有 Codex / Claude 审计结果需要注明执行环境（操作系统、Node.js 版本、pnpm 版本）。

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

- [第一阶段原始执行计划](./docs/planning/Speech-to-Scene_Phase1_Demo_Execution_Plan.md)
- [项目分析与修订建议](./docs/planning/PROJECT_ANALYSIS_AND_RECOMMENDATIONS.md)
- [M1 详细实施计划（交给 Claude 执行）](./docs/milestones/M1_IMPLEMENTATION_PLAN.md)
- [M1 代码审计报告](./docs/milestones/M1_CODE_AUDIT_REPORT.md)
- [M2 详细实施计划](./docs/milestones/M2_IMPLEMENTATION_PLAN.md)
- [M2 代码审计报告](./docs/milestones/M2_CODE_AUDIT_REPORT.md)
- [M3 详细实施计划](./docs/milestones/M3_IMPLEMENTATION_PLAN.md)
- [M3 代码审计报告](./docs/milestones/M3_CODE_AUDIT_REPORT.md)
- [M4 详细实施计划](./docs/milestones/M4_IMPLEMENTATION_PLAN.md)
- [开发环境基准记录](./docs/development/ENVIRONMENT.md)
- [项目 Schema](./docs/PROJECT_SCHEMA.md)
- [视觉语法](./docs/VISUAL_GRAMMAR.md)
- [素材许可策略](./docs/ASSET_LICENSING.md)
- [隐私说明](./docs/PRIVACY.md)
- [贡献指南](./docs/governance/CONTRIBUTING.md)
- [安全策略](./docs/governance/SECURITY.md)
- [行为准则](./docs/governance/CODE_OF_CONDUCT.md)
- [第三方声明](./docs/governance/THIRD_PARTY_NOTICES.md)

## 开源与素材许可

仓库代码采用 [MIT License](./LICENSE)。第三方图片、视频、音频及其许可证不因代码采用 MIT 而改变。项目只提供来源记录和许可辅助，不构成法律意见；使用者仍需在发布前核验具体素材页面、许可证、署名、肖像、商标和隐私要求。

## 状态

当前只完成 M0 工程骨架。后续按 M1～M6 小步实现，每个里程碑独立测试和验收。
