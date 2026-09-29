import { readSheet } from 'read-excel-file/node'

export async function readWorkbook(path: string, sheet: string | number = 1): Promise<unknown[][]> {
  // 读取公式缓存，与 openpyxl(data_only=True) 一致，不计算公式。
  return readSheet(path, sheet, { trim: false })
}
