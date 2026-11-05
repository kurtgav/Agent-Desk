// Sandboxed preload: only contextBridge + ipcRenderer. This object is the renderer's entire API.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type AgentDeckBridge } from '@shared/bridge'

/** Subscribes to a push channel; returns the unsubscribe function. */
function on<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, value: T): void => listener(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const bridge: AgentDeckBridge = {
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo),
  getSnapshot: () => ipcRenderer.invoke(IPC.snapshot),
  onSnapshot: (listener) => on(IPC.snapshotPush, listener),
  setDemo: (on) => ipcRenderer.invoke(IPC.setDemo, on),
  getStatus: () => ipcRenderer.invoke(IPC.status),
  onStatus: (listener) => on(IPC.statusPush, listener),
  onFocusItem: (listener) => on(IPC.focusItem, listener),
  dismiss: (id) => ipcRenderer.invoke(IPC.dismiss, id),
  pauseNotifications: (until) => ipcRenderer.invoke(IPC.pause, until),
  previewInstall: () => ipcRenderer.invoke(IPC.previewInstall),
  previewUninstall: () => ipcRenderer.invoke(IPC.previewUninstall),
  installHooks: () => ipcRenderer.invoke(IPC.install),
  uninstallHooks: () => ipcRenderer.invoke(IPC.uninstall)
}

contextBridge.exposeInMainWorld('agentdeck', bridge)
