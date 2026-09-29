# Excel → JSON 格式配置

默认使用 `table` 通用表格预设，将非空表头作为 JSON 字段，每个数据行生成一个对象。音效表需显式选择 `sfx`：

```console
aboom excel --input "./音效.xlsx" --preset sfx
aboom excel --input "./数据.xlsx" --preset table
aboom excel --input "./数据.xlsx" --preset table --schema "./excel.schema.json"
```

TUI 中将焦点移到“格式预设”，Enter 展开规则列表，上下选择，Enter 确认，Esc 取消；也可填写格式配置文件。常用选择可保存到 `aboom.config.json`：

```json
{
  "schemaVersion": 1,
  "tools": {
    "excel": { "preset": "table", "schema": "./excel.schema.json" }
  }
}
```

`--config` 选择工具箱默认参数文件，`--schema` 选择 Excel 格式规则文件；相对路径均基于命令执行目录。格式配置覆盖所选预设；`columns` 整体替换字段映射，因此配置中需列出所有要输出的字段。不写 `columns` 时，`table` 自动导出全部非空表头，`sfx` 继续采用音效字段。

## 自定义格式

将下面内容保存为 `excel.schema.json`。本例读取名为“配置”的工作表，第 2 行作为表头，从第 4 行开始读取数据，将中文表头映射为 JSON 字段：

```json
{
  "schemaVersion": 1,
  "sheet": "配置",
  "headerRow": 2,
  "dataStartRow": 4,
  "columns": {
    "id": { "header": "编号", "type": "integer", "required": true },
    "name": { "header": "名称", "type": "string", "default": "未命名" },
    "price": { "header": "价格", "type": "number", "default": 0 },
    "enabled": { "header": "启用", "type": "boolean", "default": false }
  },
  "skipEmpty": "id",
  "index": { "field": "sequence", "groupBy": "id" }
}
```

| 配置项 | 规则 |
| --- | --- |
| `schemaVersion` | 版本 1；省略时继承预设 |
| `sheet` | 工作表名称或从 1 开始的序号，默认 1 |
| `headerRow` | 从 1 开始的表头行，默认 1；表头去除首尾空格，可重排 |
| `dataStartRow` | 从 1 开始的数据起始行，必须在表头之后；只改表头行时默认为下一行 |
| `columns` | 输出字段 → 列规则；未映射列忽略，映射的表头必须存在且唯一 |
| `header` | Excel 表头文字，区分大小写；不能带首尾空格 |
| `type` | `auto`、`string`、`number`、`integer` 或 `boolean` |
| `required` | 默认 false；空单元格没有默认值时，必填字段报错 |
| `default` | 单元格为空时使用的值；非空单元格仍需通过类型校验 |
| `skipEmpty` | 输出字段名：对应源单元格为空时跳过该行，在默认值应用前判断；null 关闭 |
| `index` | 按 `groupBy` 输出值分组，从 1 开始依次编号到新字段 `field`；null 关闭 |

空值指缺失、null 或仅有空白的文本；完全空白的行始终忽略。没有默认值的可选字段输出 null，必填字段报错；必填字段可以配置同类型的非空默认值。默认值必须与类型匹配，可选字段允许 null。格式文件中的拼写错误、非法行号和类型错误会在扫描和写入前报错；表格错误按文件报告，指出实际数据行号和输出字段名。

`string` 接受文本并去除首尾空格，保留文本编号的前导零；`number` 接受有限数字及十进制数值文本（支持科学计数法）；`integer` 接受安全整数及整数文本；`boolean` 接受布尔值、true/false 文本和 1/0。`auto` 保留数字、布尔和文本类型，文本去除首尾空格，日期转为 ISO 字符串。无表头的列不导出；重复的已使用表头报错。

输出始终为 JSON 对象数组，保留源 XLSX。输出留空时在输入根目录新建 `aboom_output`，默认重名增加中间的 `o`；`--no-output-grow-o` 或配置中的 `"output-grow-o": false` 改为追加数字 1、2、3，TUI 可切换“输出目录增加 o”。显式指定目录支持跳过和覆盖，详见 [输入与输出目录](../README.md#输入与输出目录)。读取公式的已保存缓存，不计算公式；需要最新结果时先在表格软件中计算并保存。

## SFX 预设

`sfx` 读取首张表、首行表头，字段为 `ContentId/SFX/Event/Mode/Volume/Delay/Immediate`。空 Event 行跳过，同 ContentId 的 EventIndex 从 1 累加；Volume 默认 1，Delay 默认 -1，Immediate 默认 false，空 SFX 为 null。ContentId 为必填安全整数，Event 和 Mode 为必填文本；CLI 需传 `--preset sfx`，或在配置/TUI 中选择 `sfx`。

可复制 [完整 SFX 配置](../examples/excel-sfx.schema.json) 修改字段表头或默认值：

```console
aboom excel --preset sfx --schema "./excel-sfx.schema.json"
```

例如将 `Volume.header` 改为“音量”、`Volume.default` 改为 0.8，即可适配新的表头和空值规则。变更 `columns` 时，需同时调整引用这些字段的 `skipEmpty` 和 `index`；如不需要，设为 null。
