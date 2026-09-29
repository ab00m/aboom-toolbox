# 开发与 npm 打包

首版版本为 **0.1.0**，仅面向已有完整 Node.js 环境的 npm 用户。开发统一使用 pnpm；GitHub 仓库仅暂存代码，不配置 Actions 或自动发布。

## 首次源码启动

使用 README 中要求的 Node.js 版本及随附 npm。开发使用 `package.json` 指定的 pnpm 11.19.0；终端沿用当前系统和使用者的选择。已有本地源码时，直接进入项目目录并安装依赖。

首次获取源码：

```console
git clone https://github.com/ab00m/aboom-toolbox.git
cd aboom-toolbox
npm install --global pnpm@11.19.0
pnpm install --frozen-lockfile
pnpm dev --help
pnpm dev:tui
```

克隆后应包含 `package.json` 和 `src/`。若远端尚未同步完整源码，先使用已有本地源码；代码同步单独处理。

本分支维护 CLI / TUI，Web 工作台在 `codex/feat-web` 分支。源码插件扫描 `src/plugins/`，构建后扫描 `dist/plugins/`；`ABOOM_PLUGIN_DIR` 可替换扫描目录，`enabled: false` 停用插件。插件作为受信任的本地 Node 模块，按工具箱权限运行。

## 开发验证

```console
pnpm check
pnpm build
pnpm start --help
```

`check` 执行 lint、类型检查与源码测试，`build` 只构建项目代码，两者均不会生成 TGZ。`pnpm test` 直接测试源码；`pnpm dev:watch` 和 `pnpm build:watch` 可用于持续开发。

开发任务完成时不自动运行 pack、package、test:package 或发布。先自行验证功能，再主动执行下方的 npm 打包流程。需进行真实音频测试时，在所用终端的环境变量中将 `ABOOM_TEST_FFMPEG` 设置为可用 FFmpeg 的绝对路径；其他测试不要求该变量。

## 手动生成 npm 候选包

```console
pnpm install --frozen-lockfile
pnpm package
```

主动运行 `pnpm package` 后，`prepack` 执行 lint、类型检查、源码测试及 tsdown 构建，再由标准 `pnpm pack` 输出 `release/aboom-toolbox-0.1.0.tgz`，随后在仓库外用 npm 安装并验收。安装会从 registry 获取运行依赖，需要网络或已有依赖缓存；不再要求离线安装。

仅构建项目代码：`dist/core.mjs`、`dist/cli.mjs`、`dist/tui.mjs` 和 `dist/plugins/<名称>/index.mjs`、`plugin.json`。TGZ 使用根目录 package.json，保留 bin、Node.js 要求和 dependencies，包含 README、项目 LICENSE。`files` 白名单排除源码、测试、开发工具、调试文件和 node_modules。

Commander、React、Ink、read-excel-file 和 sharp 保持外置；npm 安装时解析依赖，Yoga WASM 与图片原生资源由依赖自身提供。同一 TGZ 可在依赖支持的系统和架构安装，构建不绑定本机平台。不再生成 ZIP、SHA256、构建摘要、平台清单或汇总第三方许可证；依赖的许可证随各自 npm 包提供。

## 主动运行分发验收

```console
pnpm test:package
pnpm verify:release
```

`test:package` 构建后生成临时标准 TGZ，验证包文件白名单、运行依赖声明、Unix 执行权限及与当前构建的一致性，并实际安装依赖和运行。它包含 pack，只有主动需要分发验收时才执行。`verify:release` 验收已手动生成的当前版本 TGZ，也可传入候选 TGZ 路径，不生成新包。

安装使用临时前缀和独立 npm 缓存，不修改真实全局安装环境；验收 aboom 命令、插件发现、配置、默认 table、显式 SFX、自定义规则、图片及音频转换。`ABOOM_TEST_FFMPEG` 指向可用 FFmpeg 时启用真实音频验收。临时安装和缓存会在结束后清理。

源码 TUI 测试覆盖连续按键、选择列表、配置预设、草稿、确认、依赖检测与停止。候选包还需在真实交互终端启动 TUI，编辑输入、执行转换并退出；非交互报错测试仅验证终端检查。

## 安装与发布

发布前安装候选包，也会安装运行依赖：

```console
npm install --global "./release/aboom-toolbox-0.1.0.tgz"
aboom --help
aboom tui
```

正式发布经安装验收的同一个 TGZ：

```console
pnpm publish "./release/aboom-toolbox-0.1.0.tgz" --access public
```

当前包尚未正式发布；发布成功后，使用者可通过 npm 安装：

```console
npm install --global aboom-toolbox
```

`pnpm pack --pack-destination release` 也会通过 prepack 检查和构建；`pnpm package` 额外进行安装验收。Node.js 与 FFmpeg 由用户本机提供，不生成独立可执行文件或附带 Node.js。运行所需依赖保留在 dependencies，开发依赖不安装到消费者环境。

## 发布前检查

```console
pnpm release:check
pnpm release:check --tag v0.1.0
```

版本同时维护 package.json 和内置插件描述；配置及描述 schemaVersion 保持为 1。release:check 要求工作区干净；提供标签时检查版本及标签提交与 HEAD 一致。开发中的未提交改动会被正常拒绝，生成候选包不要求创建标签。不维护变更日志。

提交前执行仓库 git-commit-check Skill。本地打包不上传 npm；提交、推送、标签和正式发布需用户明确授权。

## 开发参考

- [架构与共享 API](architecture.md)
- [插件开发](plugins.md)
- [编辑器设置](editor.md)
- [功能路线](roadmap.md)
