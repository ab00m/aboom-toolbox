export type ToolOptions = Record<string, string | boolean>

export interface ToolField {
  key: string
  label: string
  description: string
  type: 'text' | 'boolean' | 'select'
  required?: boolean
  default?: string | boolean
  choices?: readonly string[]
  choiceDescriptions?: Readonly<Record<string, string>>
  confirmation?: string
}

export interface Job {
  source: string
  output: string
}

export interface JobResult extends Job {
  status: 'converted' | 'skipped' | 'failed'
  message: string
}

export interface BatchSummary {
  total: number
  converted: number
  skipped: number
  failed: number
  cancelled: boolean
  outputDirectory: string
  results: JobResult[]
}

export interface ProgressEvent {
  phase?: 'scan' | 'prepare' | 'convert'
  source?: string
  completed: number
  total: number
  message: string
  result?: JobResult
}

export interface ExecutionContext {
  signal?: AbortSignal
  onProgress?: (event: ProgressEvent) => void
}

export interface ToolError {
  code: string
  message: string
  detail?: string
  solution?: string
}

export type CommandResult
  = | { ok: true, message: string, summary?: BatchSummary }
    | { ok: false, error: ToolError, summary?: BatchSummary }

export interface ToolAvailability {
  available: boolean
  message: string
  executable?: string
}

/** 插件契约；Core 和插件不依赖界面。 */
export interface ToolCommand {
  name: string
  description: string
  title?: string
  category?: string
  accent?: string
  fields?: readonly ToolField[]
  version?: string
  availability?: ToolAvailability
  check?: (options?: ToolOptions) => Promise<ToolAvailability>
  run: (options: ToolOptions, context: ExecutionContext) => CommandResult | Promise<CommandResult>
}
