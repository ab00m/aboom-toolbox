# 项目协作约定

- 使用中文沟通与编写面向使用者的说明；总结、计划和较长内容先整理逻辑再排版。
- 使用当前系统可用的终端，不指定默认 shell。命令示例采用通用语法；Node.js 脚本通过参数数组调用外部命令，兼容 Windows、macOS 和 Linux 的命令入口，不依赖特定终端程序或 shell 语法。
- 本项目是单包 TypeScript CLI / TUI 工具箱；Web 改造维护在 `codex/feat-web` 分支；新功能放在 `src/plugins/<名称>/`，使用 `plugin.json` 和默认导出的执行入口，从目录自动发现，不维护固定模块列表。
- 项目使用 pnpm；依赖和脚本通过 pnpm 管理，不生成 npm/yarn 锁文件。
- CLI、TUI 和插件统一使用 tsdown（Rolldown）构建项目代码到 `dist/`；运行依赖保持外置，由 npm 安装，sharp 平台资源由依赖自身选择。仅面向具备完整 Node.js 环境的 npm 用户，使用标准 `pnpm pack` 生成 TGZ，不复制依赖或额外生成 ZIP、SHA256 和构建清单。
- 完成开发任务时默认执行 `pnpm check`，按需运行 `pnpm build`，不要自动执行 pack、`pnpm package`、`pnpm test:package` 或发布流程。由用户自行验证后再决定打包；只有用户明确要求执行打包或分发验收时，才运行会生成 TGZ 的命令。`test:package` 包含临时 pack，也受此约束。
- `pnpm test` 直接测试源码；`pnpm check` 执行 lint、类型检查和源码测试，两者均不构建。用户主动打包时，`prepack` 执行完整检查和构建，`pnpm package` 生成标准 TGZ 并实际安装验收。修改构建配置、运行依赖或资源后的仓库外真实转换和 CLI / TUI 启动验收，在用户主动触发的 `pnpm test:package` 或打包验收阶段完成；消费者验收可使用 npm，仓库开发仍统一使用 pnpm。
- 版本同步维护 `package.json` 和内置插件描述；`pnpm release:check` 检查干净工作区和可选标签。GitHub 仓库仅暂存代码，不配置 Actions 或自动发布；本地保留 npm TGZ 打包与安装验收，不维护变更日志。
- 修改命令行为后运行 `pnpm run typecheck` 和 `pnpm test`。
- 编辑器与格式使用 `.editorconfig` 和 `@antfu/eslint-config`；2 空格、单引号、无分号。修改后运行 `pnpm lint`，使用 `pnpm lint:fix` 自动修复。
- CLI 使用 Commander，TUI 使用 React + Ink；所有入口共用目录发现、参数校验与插件执行，业务处理放入 Core，外部工具调用放入 Adapter。
- 首版为 0.1.0；Excel 默认 table，sfx 显式选择。输出留空时在输入根目录创建避重目录，output-grow-o 默认开启增加 o，关闭追加数字；指定目录沿用跳过/覆盖，新增转换复用 runConversion。
- 新增业务规则先确定输入输出，并使用真实文件验证后再更新支持说明。
- 不提交 `node_modules/`、`dist/` 或本地环境文件。
- 准备 Git 提交时，先使用仓库级 `$git-commit-check` Skill 检查提交范围和敏感信息；发现疑似凭据时暂停提交，不在回复或日志中展示其原值。
