import type { Key } from 'ink'

export function editText(value: string, cursor: number, input: string, key: Key): { value: string, cursor: number } {
  const characters = Array.from(value)
  if (key.leftArrow || key.rightArrow)
    return { value, cursor: Math.max(0, Math.min(characters.length, cursor + (key.leftArrow ? -1 : 1))) }
  if (key.home || key.end)
    return { value, cursor: key.home ? 0 : characters.length }
  if (key.ctrl && input === 'u')
    return { value: '', cursor: 0 }
  // Ink 将常用 DEL 退格序列也标记为 delete。
  if (key.backspace || key.delete) {
    if (cursor > 0)
      characters.splice(cursor - 1, 1)
    return { value: characters.join(''), cursor: Math.max(0, cursor - 1) }
  }
  if (!key.ctrl && !key.meta && input) {
    const inserted = Array.from(input).filter(char => char.codePointAt(0)! >= 32 && char !== '\x7F')
    characters.splice(cursor, 0, ...inserted)
    return { value: characters.join(''), cursor: cursor + inserted.length }
  }
  return { value, cursor }
}
