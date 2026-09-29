import type { CommandResult, ProgressEvent, ToolAvailability, ToolCommand, ToolField, ToolOptions } from '../core/types.js'
import { Box, Text } from 'ink'
import { palette } from './theme.js'

export function Menu({ commands, selected, wide }: { commands: readonly ToolCommand[], selected: number, wide: boolean }) {
  const active = commands[selected]
  return (
    <Box flexDirection={wide ? 'row' : 'column'} gap={1}>
      <Box flexDirection="column" borderStyle="round" borderColor={palette.muted} paddingX={1} {...(wide ? { width: '43%' } : {})}>
        <Text bold color={palette.muted}>工具列表</Text>
        {!commands.length && <Text color={palette.warning}>没有找到插件，请检查插件目录。</Text>}
        {commands.map((command, index) => (
          <Box key={command.name} marginTop={1} flexDirection="column">
            <Text color={index === selected ? (command.accent ?? palette.accent) : palette.text} bold={index === selected}>
              {`${index === selected ? '> ' : '  '}${command.name}  ${command.title ?? command.description}`}
              {command.availability?.available === false ? ' [不可用]' : ''}
            </Text>
          </Box>
        ))}
        <Box marginTop={1}><Text color={selected === commands.length ? palette.accent : palette.muted}>{`${selected === commands.length ? '> ' : '  '}退出`}</Text></Box>
      </Box>
      <Box flexGrow={1} flexShrink={1} flexDirection="column" borderStyle="round" borderColor={active?.accent ?? palette.accent} paddingX={1}>
        <Text color={palette.muted}>{active?.category ?? '本地工具箱'}</Text>
        <Text bold color={active?.accent ?? palette.accent}>{active?.title ?? active?.description ?? '结束本次会话'}</Text>
        <Box><Text wrap="wrap">{active?.description ?? '按 Enter 退出工具箱。'}</Text></Box>
        <Box flexDirection="column">
          {wide && <Text color={palette.muted}>文件 / 文件夹 · 批量处理</Text>}
          <Text color={palette.muted}>默认跳过已有结果 · 支持停止</Text>
        </Box>
      </Box>
    </Box>
  )
}

export function ChoiceList({ field, selected }: { field: ToolField, selected: number }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={palette.accent} paddingX={1}>
      <Text bold>{`选择${field.label}`}</Text>
      {(field.choices ?? []).map((choice, index) => (
        <Box key={choice} flexDirection="column" marginTop={1}>
          <Text color={index === selected ? palette.accent : palette.muted} bold={index === selected}>{`${index === selected ? '> ' : '  '}${choice}`}</Text>
          {field.choiceDescriptions?.[choice] && <Text color={palette.muted} wrap="wrap">{field.choiceDescriptions[choice]}</Text>}
        </Box>
      ))}
    </Box>
  )
}

export function Form({ command, values, focus, editing, cursor, confirmation, availability, checking }: { command: ToolCommand, values: ToolOptions, focus: number, editing: boolean, cursor: number, confirmation: boolean, availability: ToolAvailability | null, checking: boolean }) {
  const fields = command.fields ?? []
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={command.accent ?? palette.accent} paddingX={1}>
      <Text bold color={command.accent ?? palette.accent}>{command.title ?? command.description}</Text>
      <Text color={palette.muted}>{command.description}</Text>
      {checking ? <Text color={palette.muted}>正在检测依赖…</Text> : availability && <Text color={availability.available ? palette.success : palette.warning}>{availability.message}</Text>}
      <Box marginTop={1} flexDirection="column">
        {fields.map((field, index) => {
          const selected = focus === index
          const raw = values[field.key] ?? ''
          const value = field.type === 'boolean' ? (raw ? '[开启]' : '[关闭]') : String(raw)
          const characters = Array.from(value)
          return (
            <Box key={field.key}>
              <Box width={20} flexShrink={0}><Text color={selected ? palette.accent : palette.muted}>{`${selected ? '> ' : '  '}${field.label}${field.required ? ' *' : ''}`}</Text></Box>
              <Box flexShrink={1} flexGrow={1}>
                <Text color={selected ? palette.text : palette.muted} wrap="truncate-middle">
                  {selected && editing
                    ? (
                        <>
                          {characters.slice(0, cursor).join('')}
                          <Text inverse>{characters[cursor] ?? ' '}</Text>
                          {characters.slice(cursor + 1).join('')}
                        </>
                      )
                    : value || <Text dimColor>{field.key === 'output' ? `自动：输入目录下新建 aboom_output（重名${values['output-grow-o'] === false ? '追加 1、2、3' : '增加 o'}）` : field.required ? 'Enter 输入' : '自动 / 留空'}</Text>}
                </Text>
              </Box>
            </Box>
          )
        })}
      </Box>
      <Box marginTop={1}><Text color={focus === fields.length ? palette.success : palette.muted} bold>{`${focus === fields.length ? '> ' : '  '}开始转换`}</Text></Box>
      {command.check && <Text color={focus === fields.length + 1 ? palette.accent : palette.muted}>{`${focus === fields.length + 1 ? '> ' : '  '}重新检测依赖`}</Text>}
      <Text color={palette.muted}>{fields[focus]?.description ?? 'Enter 开始 · 源文件保持原样'}</Text>
      {confirmation && <Box marginTop={1}><Text color={palette.warning}>{`${fields.filter(field => field.confirmation && values[field.key]).map(field => field.confirmation).join(' ')}按 Y 确认，N / Esc 返回。`}</Text></Box>}
    </Box>
  )
}

export function TaskView({ command, progress, logs, result, stopping }: { command: ToolCommand | undefined, progress: ProgressEvent | null, logs: readonly string[], result: CommandResult | null, stopping: boolean }) {
  const ratio = progress && progress.total ? progress.completed / progress.total : 0
  const filled = Math.round(ratio * 20)
  const summary = result?.summary
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={result ? (result.ok ? palette.success : palette.warning) : palette.accent} paddingX={1}>
      <Text bold>{command?.title ?? command?.description}</Text>
      <Box marginTop={1} flexDirection="column">
        {result
          ? <Text color={result.ok ? palette.success : palette.warning}>{result.ok ? result.message : result.error.message}</Text>
          : <Text color={palette.accent}>{stopping ? '正在停止…' : `正在执行 ${command?.name}...`}</Text>}
        {progress && <Text color={palette.accent}>{progress.phase === 'scan' ? '正在扫描文件…' : progress.phase === 'prepare' ? `正在准备文件计划 ${progress.completed}/${progress.total}` : `${'━'.repeat(filled)}${'─'.repeat(20 - filled)}  ${Math.round(ratio * 100)}%  ${progress.completed}/${progress.total}`}</Text>}
        {summary && (
          <>
            <Text>{`成功 ${summary.converted}  ·  跳过 ${summary.skipped}  ·  失败 ${summary.failed}`}</Text>
            <Text wrap="truncate-middle">{`输出：${summary.outputDirectory}`}</Text>
          </>
        )}
        {result && !result.ok && result.error.detail && <Text wrap="wrap">{`原因: ${result.error.detail}`}</Text>}
        {result && !result.ok && result.error.solution && <Text>{`建议: ${result.error.solution}`}</Text>}
      </Box>
      {logs.length > 0 && !summary?.failed && (
        <Box marginTop={1} flexDirection="column">
          <Text color={palette.muted}>最近处理记录</Text>
          {[...new Set(logs.slice(-4))].map(line => <Text key={line} color={palette.muted} wrap="truncate-middle">{line}</Text>)}
        </Box>
      )}
      {summary?.failed
        ? (
            <Box marginTop={1} flexDirection="column">
              <Text color={palette.error}>失败记录</Text>
              {summary.results.filter(item => item.status === 'failed').slice(0, 3).map(item => <Text key={item.source} color={palette.error} wrap="truncate-middle">{item.message}</Text>)}
            </Box>
          )
        : null}
    </Box>
  )
}
