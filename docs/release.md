# 开发与 npm 打包

首版版本为 **0.1.0**，仅面向已有完整 Node.js 环境的 npm 用户。开发统一使用 pnpm；GitHub Release 托管手动发布的标准 TGZ，不配置 Actions 或自动发布。

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

## GitHub Release 成品分发

维护者在发布时打包一次，使用者直接通过 GitHub 的 TGZ 地址安装。无需向 npm registry 发布，也无需用户获取源码或运行构建。GitHub 自动生成的 Source code ZIP/TAR 不含 dist，不能代替成品附件。

维护者安装并登录 GitHub CLI，先验证功能，将发布提交同步到 GitHub main，再手动执行：

```console
pnpm package
pnpm release:github --dry-run
pnpm release:github
```

`--dry-run` 只展示标签、包路径和下载地址，不构建或上传。正式执行要求工作区干净、HEAD 与 GitHub main 一致；已有版本标签必须指向该提交。脚本先验收已有 TGZ，再创建版本 Release 和标签、上传附件，不自动提交、推送或重新打包。重复版本会失败，不覆盖已发布附件；新版本先同步 package.json 和内置插件版本。

本地包保留 `release/aboom-toolbox-0.1.0.tgz` 的版本文件名，上传时将同一文件临时复制为固定附件名 `aboom-toolbox.tgz`，结束后清理临时副本。每个 Release 仅上传一个标准 TGZ。稳定版本更新 Latest；预发布版本不会替换最新稳定版。

上传后，脚本从真实的 GitHub 固定版本地址执行隔离 npm 全局安装，核对 dist 文件与本地构建一致，验证 CLI、插件、配置及真实转换。安装失败会返回非零退出码；已经发布的 Release 会保留，排查后重新执行远程验收。

使用者安装最新版：

```console
npm install --global "https://github.com/ab00m/aboom-toolbox/releases/latest/download/aboom-toolbox.tgz"
aboom tui
```

npm 12 默认禁用远程包来源，需要在同一条命令中明确允许用户指定的远程 TGZ：

```console
npm install --global --allow-remote=root "https://github.com/ab00m/aboom-toolbox/releases/latest/download/aboom-toolbox.tgz"
```

发布验收脚本会按实际 npm 版本自动选择对应来源参数。

固定到 0.1.0：

```console
npm install --global "https://github.com/ab00m/aboom-toolbox/releases/download/v0.1.0/aboom-toolbox.tgz"
aboom --version
```

发布后的远程验收可单独运行，不创建新包或再次上传：

```console
pnpm verify:release "./release/aboom-toolbox-0.1.0.tgz" "https://github.com/ab00m/aboom-toolbox/releases/download/v0.1.0/aboom-toolbox.tgz"
```

固定附件名确保跨版本的 latest 地址保持有效，遵循 [GitHub Release 下载链接格式](https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases)。npm 支持[直接安装远程 TGZ](https://docs.npmjs.com/cli/v11/commands/npm-install/#description)，仍会从 registry 安装运行依赖；需要联网。远程 TGZ 安装不执行本项目的构建或 prepack。

## Git 源码直装

另一种方案是直接从可访问的 Git 仓库安装。维护者把源码改动提交并推送到远端后，用户无需手动打包，但需要 Git、npm 12.1+ 及其兼容的 Node.js（22.22.2+、24.15+ 或 26+）；npm 会安装开发依赖，在本机构建，再安装结果。`main` 会变化；固定标签或完整提交 SHA 更适合复现版本。

```console
npm install --global --allow-git=root --allow-scripts=aboom-toolbox "git+https://github.com/ab00m/aboom-toolbox.git#main"
aboom --version
```

无需 GitHub Release；其他 Git 托管服务或可访问的 Git 仓库也可以作为地址。npm registry 或配置的镜像仍须提供所需依赖。如果镜像缺少版本，可在命令中加 `--registry=https://registry.npmjs.org`。Git 安装通过 `prepare` 构建源码；npm 文档也将 `prepack` 列为 Git 安装生命周期，因此它已改为用 npm 执行 lint、类型检查、源码测试及构建，不要求用户预装 pnpm。成品 TGZ 包含安全的 prepare 入口，安装成品时不会要求源码或开发工具。项目日常开发和打包仍使用 pnpm。

原仓库只配置了依赖 pnpm 的 prepack，没有 prepare。本机 Node.js 24.18.0 / npm 11.16.0 的独立前缀安装复现了 tar ENOENT 警告和指向已清理 git-clone 临时目录的 Junction，且没有 aboom 命令入口。日志显示 Git 准备子进程继承了全局模式，将临时源码目录当作全局本地包链接。

npm 上游的 pacote 22.0.0 已包含[准备 Git 依赖时传入 --global=false 的修复](https://github.com/npm/pacote/blob/main/CHANGELOG.md)。[npm 生命周期文档](https://docs.npmjs.com/cli/v12/using-npm/scripts/#life-cycle-scripts)规定 Git 安装时会运行 prepack；存在 prepare 时，npm 先安装开发依赖再构建。npm 12 默认还要求显式允许 Git 来源和安装脚本，所以上述命令包含两个 allow 参数。

此前在独立工具目录对照 npm 12.1.0（内置 pacote 22.0.0）：显式允许 Git 和脚本后，原 GitHub main 安装没有 Junction，但缺少 dist/cli.mjs 和命令入口，证实仅升级 npm 不够。隔离源码安装验收使用临时 Git 仓库，不会修改系统 npm 或主仓库的 Git 历史。

远程成品安装只下载已验收的构建和运行依赖，省去用户本机的开发工具链与源码构建。Git 源码安装的当前改动尚未推送到 GitHub main；远端安装命令只有在相应提交推送后才会取得这些修复。

## npm 安装与发布

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
