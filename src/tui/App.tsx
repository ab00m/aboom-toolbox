import type { ToolCommand } from '../core/types.js'
import { Box, Text, useStdout } from 'ink'
import metadata from '../../package.json' with { type: 'json' }
import { useToolbox } from './controller.js'
import { palette } from './theme.js'
import { ChoiceList, Form, Menu, TaskView } from './views.js'

export function App({ commands }: { commands: readonly ToolCommand[] }) {
  const { stdout } = useStdout()
  const view = useToolbox(commands)
  const width = Math.max(32, Math.min(stdout.columns || 80, 102) - 2)
  const command = commands[view.selected]
  const hint = view.screen === 'menu'
    ? '↑ ↓ / j k 选择   Enter 打开   q / Esc 退出'
    : view.screen === 'result'
      ? 'Enter / Esc 返回工具列表   r 修改参数   q 退出'
      : view.screen === 'running'
        ? 's / Esc / Ctrl+C 停止转换'
        : view.screen === 'select'
          ? '↑ ↓ / j k 选择   Enter 确认   Esc 取消'
          : view.editing
            ? '输入或粘贴路径   ← → 移动   Ctrl+U 清空   Enter 保存'
            : '↑ ↓ / Tab 切换   Enter 编辑 / 选择 / 执行   ← → / 空格 选项   Esc 返回'
  return (
    <Box width={width} flexDirection="column" marginX={1}>
      <Box borderStyle="round" borderColor={palette.accent} paddingX={1} flexDirection="column">
        <Box justifyContent="space-between">
          <Text bold color={palette.accent}>ABOOM / TOOLBOX</Text>
          <Text color={palette.muted}>{`v${metadata.version}`}</Text>
        </Box>
        <Text color={palette.muted}>游戏开发工作台 · 本地转换工具</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {view.screen === 'menu'
          ? <Menu commands={commands} selected={view.selected} wide={width >= 88} />
          : view.screen === 'select' && command?.fields?.[view.focus]
            ? <ChoiceList field={command.fields[view.focus]!} selected={view.choice} />
            : (view.screen === 'form' || view.screen === 'confirm') && command
                ? <Form command={command} values={view.values} focus={view.focus} editing={view.editing} cursor={view.cursor} confirmation={view.screen === 'confirm'} availability={view.availability} checking={view.checking} />
                : <TaskView command={command} progress={view.progress} logs={view.logs} result={view.result} stopping={view.stopping} />}
      </Box>
      <Box marginTop={1} paddingX={1}><Text color={palette.muted}>{hint}</Text></Box>
    </Box>
  )
}
