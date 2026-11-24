const byId = id => document.getElementById(id)
const items = byId('items')
const progress = byId('progress')
const status = byId('status')
const controls = Object.fromEntries(['choose', 'clear', 'preview', 'run'].map(id => [id, byId(id)]))
let files = []
let previewed = false
let busy = false
let connected = false
let revision = 0

function sync() {
  controls.choose.disabled = !connected || busy
  controls.clear.disabled = !connected || busy || !files.length
  controls.preview.disabled = !connected || busy || !files.length
  controls.run.disabled = !connected || busy || !previewed
}

function draw(rows) {
  const nodes = rows.map((row) => {
    const li = document.createElement('li')
    const file = document.createElement('strong')
    const detail = document.createElement('span')
    li.dataset.status = row.status || 'queued'
    file.textContent = row.input
    detail.textContent = [row.output && `→ ${row.output}`, row.message].filter(Boolean).join(' · ')
    li.append(file, detail)
    return li
  })
  if (!nodes.length) {
    const li = document.createElement('li')
    li.className = 'empty'
    li.textContent = '还没有添加文件。'
    nodes.push(li)
  }
  items.replaceChildren(...nodes)
}

function queue(view) {
  files = view.files
  revision++
  previewed = false
  byId('count').textContent = String(files.length).padStart(2, '0')
  draw(files.map(input => ({ input })))
  status.textContent = view.message
  sync()
}

async function action(callback) {
  busy = true
  sync()
  try {
    await callback()
  }
  catch (error) {
    status.textContent = String(error)
  }
  finally {
    busy = false
    progress.hidden = true
    sync()
  }
}

async function initialize() {
  const api = window.__TAURI__
  if (!api) {
    status.textContent = '请通过 Tauri 启动。这个页面不能在普通浏览器运行转换。'
    return
  }
  const { invoke } = api.core
  const { listen } = api.event
  await Promise.all([
    listen('audio-queue', event => queue(event.payload)),
    listen('audio-error', (event) => { status.textContent = event.payload }),
    listen('audio-hover', event => document.body.classList.toggle('is-drop', event.payload && !busy)),
    listen('audio-progress', ({ payload }) => {
      progress.max = payload.total
      progress.value = payload.completed
      status.textContent = `${payload.completed} / ${payload.total} · ${payload.result.message}`
    }),
  ])
  controls.choose.addEventListener('click', () => action(async () => queue(await invoke('choose_wav'))))
  controls.clear.addEventListener('click', () => action(async () => queue(await invoke('clear_queue'))))
  controls.preview.addEventListener('click', () => action(async () => {
    const reviewing = revision
    const rows = await invoke('preview')
    if (reviewing !== revision)
      return
    draw(rows)
    previewed = rows.some(row => row.status === 'ready')
    status.textContent = '预览完成，未写入文件。'
  }))
  controls.run.addEventListener('click', () => action(async () => {
    previewed = false
    progress.hidden = false
    progress.max = files.length
    progress.value = 0
    status.textContent = '正在转换…'
    const rows = await invoke('convert_audio')
    draw(rows)
    const count = name => rows.filter(row => row.status === name).length
    status.textContent = `完成 ${count('done')} · 跳过 ${count('skipped')} · 失败 ${count('error')}`
  }))
  connected = true
  status.textContent = '文件在本机处理。转换需要可用的 FFmpeg。'
  sync()
}
initialize().catch((error) => {
  status.textContent = `启动失败：${error}`
})
