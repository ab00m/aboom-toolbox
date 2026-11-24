import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const script = readFileSync(new URL('../ui/app.mjs', import.meta.url), 'utf8')

function harness() {
  const calls = []
  const events = new Map()
  const ids = new Map()
  const classes = new Set()
  const file = 'D:\\音频\\战斗.wav'
  const output = 'D:\\音频\\战斗.ogg'
  const queue = { files: [file], message: '已添加 1 个' }
  const element = () => ({
    textContent: '',
    dataset: {},
    children: [],
    handlers: {},
    addEventListener(type, handler) { this.handlers[type] = handler },
    append(...children) { this.children.push(...children) },
    replaceChildren(...children) { this.children = children },
  })
  const document = {
    body: { classList: { toggle: (name, on) => on ? classes.add(name) : classes.delete(name) } },
    createElement: element,
    getElementById(id) {
      if (!ids.has(id))
        ids.set(id, element())
      return ids.get(id)
    },
  }
  const window = { __TAURI__: {
    event: { listen: async (name, listener) => { events.set(name, listener) } },
    core: { invoke: async (command) => {
      calls.push(command)
      if (command === 'choose_wav')
        return queue
      if (command === 'clear_queue')
        return { files: [], message: '已清空' }
      if (command === 'preview')
        return [{ input: file, output, status: 'ready', message: '另存' }]
      return [{ input: file, output, status: 'done', message: '已完成' }]
    } },
  } }
  return { calls, events, ids, classes, queue, script: runInNewContext(script, { document, window }) }
}

test('native drop adds files without starting conversion; preview unlocks conversion', async () => {
  const h = harness()
  await h.script
  h.events.get('audio-hover')({ payload: true })
  assert.ok(h.classes.has('is-drop'))
  h.events.get('audio-hover')({ payload: false })
  assert.ok(!h.classes.has('is-drop'))
  h.events.get('audio-queue')({ payload: h.queue })
  assert.deepEqual(h.calls, [])
  assert.equal(h.ids.get('run').disabled, true)
  await h.ids.get('preview').handlers.click()
  assert.equal(h.ids.get('run').disabled, false)
  assert.match(h.ids.get('items').children[0].children[1].textContent, /战斗\.ogg/)
  await h.ids.get('run').handlers.click()
  assert.deepEqual(h.calls, ['preview', 'convert_audio'])
  assert.match(h.ids.get('status').textContent, /完成 1/)
  assert.equal(h.ids.get('run').disabled, true)
})

test('file chooser and clear use native commands; a new drop invalidates preview', async () => {
  const h = harness()
  await h.script
  await h.ids.get('choose').handlers.click()
  await h.ids.get('preview').handlers.click()
  h.events.get('audio-queue')({ payload: h.queue })
  assert.equal(h.ids.get('run').disabled, true)
  await h.ids.get('clear').handlers.click()
  assert.deepEqual(h.calls, ['choose_wav', 'preview', 'clear_queue'])
  assert.equal(h.ids.get('count').textContent, '00')
})
