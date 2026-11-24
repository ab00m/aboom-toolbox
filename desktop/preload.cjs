const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('toolbox', {
  selectFile: () => ipcRenderer.invoke('image:file'),
  selectFolder: () => ipcRenderer.invoke('image:folder'),
  selectOutput: () => ipcRenderer.invoke('image:output'),
  resetOutput: () => ipcRenderer.invoke('image:reset-output'),
  run: options => ipcRenderer.invoke('image:run', options),
  cancel: () => ipcRenderer.invoke('image:cancel'),
  onProgress: (callback) => { ipcRenderer.on('image:progress', (_event, payload) => callback(payload)) },
})
