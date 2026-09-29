import type { ToolCommand } from '../../core/types.js'
import { readFile, writeFile } from 'node:fs/promises'
import { runConversion } from '../../core/index.js'
import { readWorkbook } from './adapter.js'
import { convertRows } from './core.js'
import { resolveSchema } from './schema.js'

const excelPlugin: Pick<ToolCommand, 'run'> = {
  async run(options, context) {
    const schemaPath = typeof options.schema === 'string' ? options.schema.trim().replace(/^"(.*)"$/, '$1') : ''
    let config: unknown = {}
    if (schemaPath) {
      try {
        config = JSON.parse((await readFile(schemaPath, 'utf8')).replace(/^\uFEFF/, ''))
      }
      catch (error) {
        throw new Error(`无法读取 Excel 格式配置 ${schemaPath}：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const schema = resolveSchema(typeof options.preset === 'string' ? options.preset : 'table', config)
    return runConversion(options, context, {
      sourceExtension: '.xlsx',
      targetExtension: '.json',
      ignoreOfficeTemporary: true,
      async write(job, temporary) {
        const data = convertRows(await readWorkbook(job.source, schema.sheet), schema)
        await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
        return `${data.length} 条`
      },
    })
  },
}

export default excelPlugin
