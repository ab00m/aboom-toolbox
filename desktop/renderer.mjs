const get = id => document.getElementById(id)
function display(id, value) {
  get(id).textContent = value
}
for (const [id, method, target] of [
  ['file', 'selectFile', 'input'],
  ['folder', 'selectFolder', 'input'],
  ['choose-output', 'selectOutput', 'output'],
  ['reset-output', 'resetOutput', 'output'],
]) {
  get(id).addEventListener('click', async () => {
    try {
      const path = await window.toolbox[method]()
      if (path || method === 'resetOutput')
        display(target, path || '自动创建新目录')
    }
    catch (error) {
      display('message', error.message)
    }
  })
}
get('cancel').addEventListener('click', async () => {
  get('cancel').disabled = true
  try {
    await window.toolbox.cancel()
  }
  catch (error) {
    display('message', error.message)
  }
})
window.toolbox.onProgress((event) => {
  const bar = get('progress')
  if (event.total > 0) {
    bar.max = event.total
    bar.value = event.completed
  }
  else {
    bar.removeAttribute('value')
  }
  display('message', event.message)
})
get('convert').addEventListener('submit', async (event) => {
  event.preventDefault()
  const dryRun = event.submitter?.value !== 'run'
  get('fields').disabled = true
  get('cancel').hidden = false
  get('cancel').disabled = false
  get('progress').hidden = false
  get('progress').removeAttribute('value')
  get('results').replaceChildren()
  display('message', dryRun ? '正在生成预览…' : '正在处理…')
  try {
    const result = await window.toolbox.run({ size: get('size').value, dryRun, recursive: get('recursive').checked })
    const summary = result.summary
    const status = result.ok ? result.message : [result.error.message, result.error.detail, result.error.solution].filter(Boolean).join(' ')
    display('message', summary ? `${status} 输出：${summary.outputDirectory}` : status)
    for (const item of summary?.results ?? []) {
      const li = document.createElement('li')
      li.textContent = `${item.message} · ${item.source} → ${item.output}`
      get('results').append(li)
    }
  }
  catch (error) {
    display('message', error.message)
  }
  finally {
    get('fields').disabled = false
    get('progress').hidden = true
    get('cancel').hidden = true
    event.submitter?.focus()
  }
})
