# 插件开发

源码目录为 `src/plugins/`，分发目录为 `dist/plugins/`；每个插件有自己的 `plugin.json`、执行入口、纯规则 Core 和 Adapter。新增插件无需维护固定注册列表。

## 描述

```json
{
  "schemaVersion": 1,
  "name": "example",
  "version": "0.1.0",
  "title": "示例工具",
  "description": "描述实际支持的功能",
  "entry": "index.ts",
  "fields": [
    { "key": "input", "label": "输入路径", "description": "默认当前目录", "type": "text", "default": "." },
    { "key": "output", "label": "输出目录", "description": "留空自动创建目录", "type": "text", "default": "" },
    { "key": "output-grow-o", "label": "输出目录增加 o", "description": "自动输出重名时开启增加 o，关闭追加数字", "type": "boolean", "default": true },
    {
      "key": "preset",
      "label": "格式预设",
      "description": "选择处理规则",
      "type": "select",
      "choices": ["table", "sfx"],
      "choiceDescriptions": { "table": "通用表格", "sfx": "音效规则" },
      "default": "table"
    }
  ]
}
```

名称以小写字母开头，只包含小写字母、数字和连字符，不能与 tui/plugins/config/help 重名；名称必须唯一。version 使用三段版本号，可带预发布后缀；schemaVersion 为 1。entry 必须是插件自身目录内的 JS/TS 模块。

字段支持 text/select/boolean；文本及枚举使用字符串，开关使用布尔值。choices 必须非空、无重复；可选 choiceDescriptions 只描述 choices 内的值。default、required、confirmation 由 CLI/TUI 共用，确认说明用于覆盖等操作。

## 执行入口与批量转换

```ts
import type { ToolCommand } from '../../core/index.js'
import { writeFile } from 'node:fs/promises'
import { runConversion } from '../../core/index.js'

export default {
  async run(options, context) {
    return runConversion(options, context, {
      sourceExtension: '.txt',
      targetExtension: '.json',
      async write(job, temporary) {
        await writeFile(temporary, JSON.stringify({ source: job.source }))
      },
    })
  },
} satisfies Pick<ToolCommand, 'run'>
```

纯业务规则放 core.ts，文件格式库及外部程序放 adapter.ts。插件不打印日志或退出进程，通过 onProgress 回报进度、AbortSignal 响应停止，返回 CommandResult。

批量转换优先复用 runConversion：

| 回调 | 用途 |
| --- | --- |
| prepare(job) | 可选，返回 data 与可选 name；name 只能是最终文件名，不含目录 |
| beforeRun(jobs, context, paths) | 可选，计划及碰撞检查后检测执行依赖；paths.automatic 标识是否分配新目录 |
| write(job, temporary) | 写入临时文件；job.data 为准备数据，可返回结果说明 |
| preview(job) | 可选，dry-run 时返回预览说明，不写文件 |

Core 统一默认路径、扫描、逐文件准备错误、最终碰撞检查、跳过/覆盖、原子提交、进度和取消。默认输入当前目录；output 留空则跟随输入根目录创建避重目录，非空则使用指定目录。output-grow-o 默认 true，重名时增加中间的 o；false 时追加数字 1、2、3。插件在描述中声明该布尔字段即可让 CLI、配置和 TUI 共用开关，显式目录忽略开关。

低层 collectJobs、atomicOutput、runBatch 仍公开供特殊流程使用；resolveConversionPaths 为异步接口。新流程应统一通过公开 Core 入口导入，避免在各插件复制生命周期逻辑。

可选 check(options) 返回 available、message 和可选 executable，TUI 提供重新检测。真正执行时必须再次检查依赖；检测结果只是当时状态。

内置 `screenshot` 插件是单独的截图压缩命令，不改变 `image` 插件原有的裁切与缩放行为。它默认以 WebP 质量 85 输出，保持宽高比、不裁切，并将最长边限制在 1080 像素；可选 JPEG、PNG 或原格式。

## 发现、停用与分发

1. 创建描述及默认执行入口，运行 pnpm dev plugins 检查发现结果。
2. 补充有实际输入输出的测试，运行 pnpm check。
3. 修改运行资源、依赖或构建后先运行 pnpm check，按需构建并自行验证。用户主动打包或要求分发验收时，再通过 pnpm package 或 pnpm test:package 验收仓库外安装和真实转换；开发任务完成时不自动 pack。

enabled: false 停用插件；ABOOM_PLUGIN_DIR 替换目录。空目录显示空状态，坏插件单独报告；描述与代码变更在下次启动生效。

分发描述 entry 改写为 index.mjs，自定义插件使用 JS/MJS。内置插件的外部依赖在 package.json 的 dependencies 中声明，由 npm 安装；sharp 原生资源由依赖自身选择。自定义插件需确保运行依赖可从插件目录解析，并在实际安装环境验证。

插件以工具箱进程权限运行。首版提供本地目录插件，没有自动市场、依赖版本隔离或复杂工作流引擎。
