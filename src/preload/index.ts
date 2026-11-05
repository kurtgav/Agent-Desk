// Sandboxed preload: only contextBridge + ipcRenderer. This object is the renderer's entire API.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type AgentDeckBridge } from '@shared/bridge'
import type { Snapshot } from '@shared/snapshot'

const bridge: AgentDeckBridge = {
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo),
  getSnapshot: () => ipcRenderer.invoke(IPC.snapshot),
  onSnapshot: (listener) => {
    const handler = (_e: IpcRendererEvent, s: Snapshot | null): void => listener(s)
    ipcRenderer.on(IPC.snapshotPush, handler)
    return () => ipcRenderer.removeListener(IPC.snapshotPush, handler)
  },
  setDemo: (on) => ipcRenderer.invoke(IPC.setDemo, on)
}

contextBridge.exposeInMainWorld('agentdeck', bridge)
