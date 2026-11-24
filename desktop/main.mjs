import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { app, BrowserWindow, dialog, ipcMain, protocol } from 'electron'
// The native entry intentionally consumes the same built Core as the CLI.
// eslint-disable-next-line antfu/no-import-dist
import { discoverPlugins, executeCommand } from '../dist/core.mjs'
import { createImageConversion } from './conversion.mjs'

const appUrl = 'toolbox://desktop/index.html'
const assets = new Map([
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.css', ['app.css', 'text/css; charset=utf-8']],
  ['/renderer.mjs', ['renderer.mjs', 'text/javascript; charset=utf-8']],
])
const csp = 'default-src \'none\'; script-src \'self\'; style-src \'self\'; base-uri \'none\'; frame-ancestors \'none\'; form-action \'none\''

protocol.registerSchemesAsPrivileged([{ scheme: 'toolbox', privileges: { standard: true, secure: true } }])
const sessions = new Map()

function sessionFor(event) {
  const session = sessions.get(event.sender.id)
  if (!session || !event.senderFrame || event.senderFrame.parent !== null || event.senderFrame.url !== appUrl)
    throw new Error('无法验证桌面窗口。')
  return session
}

function openWindow(image) {
  const window = new BrowserWindow({
    width: 920,
    height: 740,
    minWidth: 550,
    minHeight: 570,
    backgroundColor: '#f7f4ee',
    title: 'Aboom Toolbox',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  const contents = window.webContents
  const id = contents.id
  const conversion = createImageConversion(image, executeCommand)
  sessions.set(id, { window, conversion, picking: false })
  contents.on('will-navigate', event => event.preventDefault())
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.on('closed', () => {
    conversion.cancel()
    sessions.delete(id)
  })
  return window.loadURL(appUrl)
}

async function start() {
  await app.whenReady()
  const catalog = await discoverPlugins(join(import.meta.dirname, '../dist/plugins'))
  const image = catalog.commands.find(command => command.name === 'image')
  if (!image) {
    dialog.showErrorBox('Aboom Toolbox', '找不到图片插件，请先运行 pnpm build。')
    app.quit()
    return
  }
  protocol.handle('toolbox', async (request) => {
    const url = new URL(request.url)
    const asset = url.hostname === 'desktop' && !url.search && assets.get(url.pathname)
    if (!asset || request.method !== 'GET')
      return new Response(null, { status: 404 })
    const [name, type] = asset
    return new Response(await readFile(join(import.meta.dirname, name)), { headers: { 'Content-Type': type, 'Content-Security-Policy': csp } })
  })
  const openDialog = async (event, kind) => {
    const session = sessionFor(event)
    if (session.picking)
      return null
    session.picking = true
    try {
      const file = kind === 'file'
      const result = await dialog.showOpenDialog(session.window, {
        title: kind === 'output' ? '选择输出文件夹' : file ? '选择输入图片' : '选择输入文件夹',
        properties: [file ? 'openFile' : 'openDirectory'],
        ...(file ? { filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg'] }] } : {}),
      })
      const selected = result.canceled ? null : result.filePaths[0]
      if (selected)
        session.conversion.setPath(kind, selected)
      return selected ?? null
    }
    finally {
      session.picking = false
    }
  }
  ipcMain.handle('image:file', event => openDialog(event, 'file'))
  ipcMain.handle('image:folder', event => openDialog(event, 'folder'))
  ipcMain.handle('image:output', event => openDialog(event, 'output'))
  ipcMain.handle('image:reset-output', (event) => {
    sessionFor(event).conversion.setPath('output', '')
  })
  ipcMain.handle('image:run', (event, payload) => sessionFor(event).conversion.run(payload, (progress) => {
    if (!event.sender.isDestroyed())
      event.sender.send('image:progress', progress)
  }))
  ipcMain.handle('image:cancel', event => sessionFor(event).conversion.cancel())
  await openWindow(image)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0)
      void openWindow(image).catch(reportStartupError)
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
      app.quit()
  })
}

function reportStartupError(error) {
  dialog.showErrorBox('Aboom Toolbox 启动失败', String(error))
  app.quit()
}
void start().catch(reportStartupError)
