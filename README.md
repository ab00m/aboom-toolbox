# Aboom Toolbox

面向游戏开发的本地 CLI / TUI 工具箱，首版为 **0.1.0**。提供 Excel → JSON、音频格式转换和图片裁切缩放，通过目录自动发现插件。

需要完整的 Node.js 环境：22.18+（22.x）、24.11+（24.x）或 26+，包含 npm；音频转换另需本地 FFmpeg。任务在本机执行，源文件保留。CLI 可在系统常用终端中运行，TUI 需要支持交互输入的终端。

## 安装与启动

可以直接从 Git 仓库安装源码，不需要维护者创建 Release 或让使用者手动打包。待本次改动提交并推送到远端 `main` 后，使用者安装 Git、npm 12.1+ 及其兼容的 Node.js（22.22.2+、24.15+ 或 26+），运行：

```console
npm install --global --allow-git=root --allow-scripts=aboom-toolbox "git+https://github.com/ab00m/aboom-toolbox.git#main"
aboom --help
```

Git 地址可以换成其他可访问的 Git 托管地址；`#main` 可换成标签或完整提交号。安装过程会下载开发依赖并在使用者本机完成构建，需要能访问 npm registry；如果 npm 镜像缺少版本，可在安装命令中指定 `--registry=https://registry.npmjs.org`。本机 npm 11.16.0 的全局 Git 安装存在上游缺陷，详见[分发说明](docs/release.md#git-源码直装)。

若维护者发布了已构建的成品包，也可从 GitHub Release 安装。完成[首次发布](docs/release.md#github-release-成品分发)后，使用者运行：

```console
npm install --global "https://github.com/ab00m/aboom-toolbox/releases/latest/download/aboom-toolbox.tgz"
aboom tui
```

用户只需 Node.js 和 npm，无需 Git、pnpm、克隆源码或打包。需要固定版本时，将地址中的 `latest/download` 换成 `download/v0.1.0`。更新时重新执行同一条安装命令。

npm 12 的命令需追加 `--allow-remote=root`，明确允许本次远程 TGZ 来源。

正式发布到 npm 后，也可安装并启动：

```console
npm install --global aboom-toolbox
aboom --help
aboom tui
```

发布前，如已取得候选 TGZ，可从其所在目录安装；将文件名替换为实际路径：

```console
npm install --global "./aboom-toolbox-0.1.0.tgz"
aboom tui
aboom --help
```

npm 会自动安装运行依赖；安装时需要网络或已有依赖缓存。Node.js 与 FFmpeg 由本机提供。

成品 TGZ 和源码归档是不同的文件。两种安装方式及验证结论见[分发说明](docs/release.md)。

## 常用命令

```console
aboom excel --input "./素材/数据.xlsx"
aboom excel --input "./素材/音效.xlsx" --preset sfx
aboom audio --input "./素材/音频" --from WAV --to OGG --recursive
aboom image --input "./素材/图片" --size 2048 --crop-multiple --multiple 4 --recursive
aboom screenshot --input "./素材/截图" --format webp --quality 85 --recursive
aboom image --input "./素材/图片" --dry-run --json
aboom plugins
```

- **Excel**：默认 `table`，首张表、首行表头，每个数据行导出一个 JSON 对象；支持显式 `sfx` 预设和 `--schema` 自定义规则。读取已保存的公式缓存，不重新计算公式。[格式配置](docs/excel.md)
- **音频**：WAV/FLAC/OGG/MP3 互转。FLAC 无损，OGG 使用 libvorbis 质量 5，MP3 使用 libmp3lame 质量 2，WAV 为 16 位 PCM；保留采样率。可用 `--ffmpeg`、`ABOOM_FFMPEG` 或 PATH 指定程序，也会检查常见安装位置。显式路径无效时提示修正。
- **图片**：PNG/JPG/JPEG 按最长边等比缩放，默认 2048；小图原样复制，`--allow-upscale` 允许放大。按倍数居中裁切在缩放后执行。缩放文件追加 `@<尺寸>`，裁切追加 `@clip`；保留 PNG 透明通道，JPEG 质量 92，校正 EXIF 方向。`--dry-run` 只预览，不生成文件或目录。
- **截图压缩**：独立的 `screenshot` 命令，不执行裁切。默认转为 WebP（质量 85），等比缩小到最长边 1080 像素，适合贴入文档；也可选 JPEG、PNG 或原格式。

## 输入与输出目录

输入默认当前目录，可以指定文件或文件夹；路径支持双引号粘贴和 `~`。指定的相对路径以启动目录为基准。

**输出留空或省略时，在输入根目录下新建输出文件夹。** 文件输入的根目录是文件所在目录，文件夹输入的根目录是该文件夹自身。

| 输入 | 首次自动输出 |
| --- | --- |
| `./素材/数据.xlsx` | `./素材/aboom_output` |
| `./素材/图片` | `./素材/图片/aboom_output` |

名称被文件、文件夹或链接占用时，默认持续增加中间的 `o`：`aboom_output`、`abooom_output`、`aboooom_output`。关闭 `output-grow-o` 则追加数字：`aboom_output`、`aboom_output1`、`aboom_output2`、`aboom_output3`。两种模式都选择首个未占用名称，每次任务使用一个新目录；并发任务独立分配。

```console
aboom excel --no-output-grow-o
aboom excel --output-grow-o
```

`--no-output-grow-o` 使用数字后缀；`--output-grow-o` 增加 o，可覆盖配置中的 false。Excel、音频和图片共用此选项；TUI 在“输出目录增加 o”字段切换，配置使用 `"output-grow-o": false`。此开关只影响自动输出，指定目录不受影响。

显式 `--output` 或配置中的非空输出路径表示指定目录，即使填写 `aboom_output` 也按指定目录处理：默认跳过同名结果，`--overwrite` 允许覆盖。

递归保留子目录结构，并排除当前输出目录及两种命名模式的历史目录（`abo{2,}m_output` 或 `aboom_output[1-9][0-9]*`）。这些名称保留给工具箱结果；用户可以显式选中其中一个目录作为新的输入根目录。

无匹配文件和前置校验失败不创建目录；预览只显示候选路径，不占用名称。失败或取消清理临时文件和本次空目录，保留已完成结果。

## TUI 操作

运行 `aboom tui`，在真实交互终端中操作：

| 页面 | 操作 |
| --- | --- |
| 工具列表 | ↑/↓ 或 j/k 选择，Enter 打开，q/Esc 退出 |
| 参数表单 | ↑/↓ 或 Tab/Shift+Tab 切换；Enter 编辑、选择或执行 |
| 文本编辑 | 支持粘贴、Unicode 光标、退格、Home/End；Ctrl+U 清空，Enter 保存 |
| 选项列表 | Enter 展开，↑/↓ 或 j/k 选择，Enter 确认，Esc 取消；表单中可左右快速切换 |
| 覆盖确认 | Y 执行，N/Esc 返回 |
| 执行中 | s/Esc/Ctrl+C 停止 |
| 结果页 | r 修改参数，Enter/Esc 返回，q 退出 |

Excel 预设列表显示 `table` 和 `sfx` 的规则说明。参数草稿在会话中保留；输出留空时，每次运行重新分配目录。音频和图片表单可“重新检测依赖”，采用当前参数。

Excel 解析和图片编码完成后在安全点响应取消；停止音频会终止 FFmpeg 子进程。

## 默认配置

```console
aboom config init
aboom config show
aboom config path
aboom excel --config "./aboom.config.json" --preset table
aboom image --no-allow-upscale --no-overwrite
```

`config init` 生成全部插件默认参数，已有文件不覆盖。示例：

```json
{
  "schemaVersion": 1,
  "tools": {
    "excel": { "preset": "table", "output": "", "output-grow-o": false },
    "audio": { "to": "OGG", "recursive": true },
    "image": { "size": "1024", "crop-multiple": true, "multiple": "4" }
  }
}
```

优先级为 **显式参数 > 配置文件 > 插件默认值**，保留显式 `false` 和空字符串。TUI 使用同一配置，启用覆盖时仍需确认；已有配置中的 `preset: "sfx"` 和非空输出目录继续生效。

配置来源按 `--config` > `ABOOM_CONFIG` > 当前目录 `aboom.config.json` > 用户配置选择，只读取一份。Windows 用户配置为 `%APPDATA%/AboomToolbox/config.json`，其他系统为 `$XDG_CONFIG_HOME/aboom/config.json` 或 `~/.config/aboom/config.json`。

字段与插件参数对应，使用原始连字符名称：文本和枚举填字符串，开关填布尔值。未知插件/字段、错误类型、枚举或损坏文件会报错；默认文件缺失时使用内置默认值。配置内相对路径也基于启动目录。

## 进度与脚本输出

普通模式在 stderr 显示扫描、准备及转换进度；交互终端原地刷新，非交互环境输出普通文本。转换百分比按完成文件数计算。

```console
aboom excel --input "./tables" --progress
aboom excel --no-progress
aboom excel --quiet
aboom excel --json
```

`--progress` 默认开启；`--no-progress` 保留文件记录和统计；`--quiet` 仅输出错误；`--json` 优先，stdout 输出完整结构化结果，stderr 不显示进度。实际输出目录见 `summary.outputDirectory`，每个文件见 `summary.results`。退出码：成功 0、失败 1、取消 130。
