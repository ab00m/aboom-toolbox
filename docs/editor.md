# VS Code 工作区设置

工作区仅维护 `.vscode/settings.json`，设置只作用于当前项目。终端沿用使用者的选择。

- 缩进为 2 空格，使用 LF 换行，补齐末尾换行并清理行尾空格；Markdown 保留行尾空格。
- 格式化入口为 ESLint，关闭 Prettier；手动保存执行 ESLint 修复，不启用通用 fixAll 或导入整理。相关扩展设置在对应扩展已安装时生效。
- 隐藏可自动修复的格式诊断，不隐藏真正的 ESLint 警告和错误。Error Lens 显示错误、警告，延迟 500ms；拼写提示只保留在普通诊断中。
- 英文拼写启用组合词和项目词汇，排除依赖、构建产物、锁文件和本地代理配置；中文说明继续正常编写。
- `package.json` 下折叠 pnpm、EditorConfig 和 ESLint 配置，`.gitignore` 下折叠 `.gitattributes`，`tsconfig.json` 下折叠其他 tsconfig 文件。
- 搜索及文件监听排除 `node_modules/`、`dist/`、`release/`，但不在资源管理器隐藏它们；锁文件仍可直接打开。
- npm 脚本面板使用 pnpm；集成终端沿用 VS Code 的用户设置。
- 未填写 `typescript.tsdk`：当前 `typescript` 是 ESLint 所需的 6.x API 兼容包，没有该位置的 `tsserver.js`。编辑器语言服务保持默认，类型检查以 `pnpm typecheck` 为准。

源码运行、验证和本地打包步骤见 [开发与 npm 打包](release.md)。
