// 分发包转换冒烟验收：在独立目录中验证打包后的 CLI 能发现插件并完成关键格式转换。
// “冒烟测试”（smoke test）用于快速确认核心流程可运行，不替代完整测试与边界覆盖。
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { strToU8, zipSync } from 'fflate'
import sharp from 'sharp'

export const sfxHeaders = ['ContentId', 'SFX', 'Event', 'Mode', 'Volume', 'Delay', 'Immediate']
export const expectedSfx = [{ ContentId: 1001, EventIndex: 1, SFX: '测试音效', Event: 'event:/test', Mode: 'Play', Volume: 1, Delay: -1, Immediate: false }]
export const expectedTable = [{ ContentId: 1001, SFX: '测试音效', Event: 'event:/test', Mode: 'Play', Volume: null, Delay: null, Immediate: null }]

function xml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

/** 小型真实 OOXML 工作簿，测试不依赖个人素材或 Python。 */
export function workbookBytes(rows = [sfxHeaders, [1001, '测试音效', 'event:/test', 'Play']]) {
  const worksheet = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, column) => {
    const ref = `${String.fromCharCode(65 + column)}${rowIndex + 1}`
    if (value === undefined || value === null)
      return ''
    if (typeof value === 'number')
      return `<c r="${ref}"><v>${value}</v></c>`
    if (typeof value === 'boolean')
      return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`
    if (typeof value === 'object' && 'formula' in value)
      return `<c r="${ref}"><f>${xml(value.formula)}</f>${value.cached === undefined ? '' : `<v>${value.cached}</v>`}</c>`
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`
  }).join('')}</row>`).join('')
  const parts = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="SFX" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${worksheet}</sheetData></worksheet>`,
  }
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(parts).map(([name, value]) => [name, strToU8(value)]))))
}

export function wavBytes() {
  const samples = 1600
  const data = Buffer.alloc(44 + samples * 2)
  data.write('RIFF')
  data.writeUInt32LE(data.length - 8, 4)
  data.write('WAVEfmt ', 8)
  data.writeUInt32LE(16, 16)
  data.writeUInt16LE(1, 20)
  data.writeUInt16LE(1, 22)
  data.writeUInt32LE(8000, 24)
  data.writeUInt32LE(16000, 28)
  data.writeUInt16LE(2, 32)
  data.writeUInt16LE(16, 34)
  data.write('data', 36)
  data.writeUInt32LE(samples * 2, 40)
  for (let index = 0; index < samples; index++)
    data.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * 440 / 8000) * 12000), 44 + index * 2)
  return data
}

export async function verifyConversions(cli, directory, environment = {}) {
  const env = { ...process.env, NODE_PATH: '', NODE_OPTIONS: '', ...environment }
  const catalog = spawnSync(process.execPath, [cli, 'plugins', '--json'], { cwd: directory, encoding: 'utf8', timeout: 30000, env })
  if (catalog.status !== 0)
    throw new Error(`独立插件发现失败：${catalog.stderr || catalog.stdout}`)
  const names = new Set(JSON.parse(catalog.stdout).tools.map(tool => tool.name))
  if (names.has('excel')) {
    const source = join(directory, '验收 sample.xlsx')
    const bytes = workbookBytes()
    await writeFile(source, bytes)
    const result = spawnSync(process.execPath, [cli, 'excel', '--json'], { cwd: directory, encoding: 'utf8', timeout: 30000, env })
    if (result.status !== 0 || !JSON.parse(result.stdout).ok)
      throw new Error(`独立 Excel 转换失败：${result.stderr || result.stdout}`)
    const output = await readFile(JSON.parse(result.stdout).summary.results[0].output, 'utf8')
    if (JSON.stringify(JSON.parse(output)) !== JSON.stringify(expectedTable) || !bytes.equals(await readFile(source)))
      throw new Error('独立 Excel 转换结果或源文件校验失败')
    const sfx = spawnSync(process.execPath, [cli, 'excel', '--input', source, '--preset', 'sfx', '--json'], { cwd: directory, encoding: 'utf8', timeout: 30000, env })
    if (sfx.status !== 0 || !JSON.parse(sfx.stdout).ok)
      throw new Error(`独立 SFX 转换失败：${sfx.stderr || sfx.stdout}`)
    const sfxResult = JSON.parse(sfx.stdout).summary
    if (sfxResult.outputDirectory === JSON.parse(result.stdout).summary.outputDirectory
      || JSON.stringify(JSON.parse(await readFile(sfxResult.results[0].output, 'utf8'))) !== JSON.stringify(expectedSfx)) {
      throw new Error('独立 SFX 预设或连续转换目录分配失败')
    }
    const customSource = join(directory, '通用 table.xlsx')
    const schema = join(directory, 'excel-format.json')
    await writeFile(customSource, workbookBytes([['说明'], ['编号', '名称'], [7, '测试'], [8]]))
    await writeFile(schema, JSON.stringify({ sheet: 'SFX', headerRow: 2, columns: { id: { header: '编号', type: 'integer', required: true }, name: { header: '名称', type: 'string', default: '未命名' } } }))
    const custom = spawnSync(process.execPath, [cli, 'excel', '--input', customSource, '--schema', schema, '--json'], { cwd: directory, encoding: 'utf8', timeout: 30000, env })
    if (custom.status !== 0 || !JSON.parse(custom.stdout).ok || custom.stderr)
      throw new Error(`独立 Excel 格式配置或进度失败：${custom.stderr || custom.stdout}`)
    const customOutput = JSON.parse(await readFile(JSON.parse(custom.stdout).summary.results[0].output, 'utf8'))
    if (JSON.stringify(customOutput) !== JSON.stringify([{ id: 7, name: '测试' }, { id: 8, name: '未命名' }]))
      throw new Error('独立 Excel 字段映射或默认值未生效')
    for (const name of ['aboom_output1', 'aboom_output2', 'aboom_output3']) {
      const numbered = spawnSync(process.execPath, [cli, 'excel', '--input', source, '--no-output-grow-o', '--json'], { cwd: directory, encoding: 'utf8', timeout: 30000, env })
      if (numbered.status !== 0 || !JSON.parse(numbered.stdout).ok)
        throw new Error(`独立数字后缀转换失败：${numbered.stderr || numbered.stdout}`)
      const summary = JSON.parse(numbered.stdout).summary
      if (summary.outputDirectory !== join(directory, name)
        || JSON.stringify(JSON.parse(await readFile(summary.results[0].output, 'utf8'))) !== JSON.stringify(expectedTable)) {
        throw new Error('独立数字后缀目录分配或默认 table 结果错误')
      }
    }
  }
  if (names.has('image')) {
    const image = join(directory, '验收 image.png')
    const imageBytes = await sharp({ create: { width: 83, height: 47, channels: 4, background: '#71956280' } }).png().toBuffer()
    await writeFile(image, imageBytes)
    const resized = spawnSync(process.execPath, [cli, 'image', '--size', '40', '--crop-multiple', '--json'], { cwd: directory, encoding: 'utf8', timeout: 30000, env })
    if (resized.status !== 0 || !JSON.parse(resized.stdout).ok)
      throw new Error(`独立图片转换失败：${resized.stderr || resized.stdout}`)
    const imageOutput = await sharp(JSON.parse(resized.stdout).summary.results[0].output).metadata()
    if (imageOutput.width !== 40 || imageOutput.height !== 20 || !imageBytes.equals(await readFile(image)))
      throw new Error('独立图片转换结果或源文件校验失败')
    const config = join(directory, '验收 defaults.json')
    await writeFile(config, JSON.stringify({ schemaVersion: 1, tools: { image: { 'input': image, 'output': 'configured-output', 'size': '20', 'crop-multiple': true, 'dry-run': true, 'recursive': true } } }))
    const configured = spawnSync(process.execPath, [cli, 'image', '--config', config, '--no-dry-run', '--no-crop-multiple', '--no-recursive', '--json'], { cwd: directory, encoding: 'utf8', timeout: 30000, env })
    if (configured.status !== 0 || JSON.parse(configured.stdout).summary.converted !== 1)
      throw new Error(`独立配置转换失败：${configured.stderr || configured.stdout}`)
    const configuredImage = await sharp(JSON.parse(configured.stdout).summary.results[0].output).metadata()
    if (configuredImage.width !== 20 || configuredImage.height !== 11)
      throw new Error('独立配置默认值或布尔覆盖未生效')
  }
  if (names.has('audio') && process.env.ABOOM_TEST_FFMPEG) {
    const audio = join(directory, '验收 tone.wav')
    await writeFile(audio, wavBytes())
    const converted = spawnSync(process.execPath, [cli, 'audio', '--ffmpeg', process.env.ABOOM_TEST_FFMPEG, '--json'], { cwd: directory, encoding: 'utf8', timeout: 30000, env })
    if (converted.status !== 0 || !JSON.parse(converted.stdout).ok || (await readFile(JSON.parse(converted.stdout).summary.results[0].output)).subarray(0, 4).toString() !== 'fLaC')
      throw new Error(`独立音频转换失败：${converted.stderr || converted.stdout}`)
  }
}
