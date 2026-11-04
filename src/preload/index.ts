// Sandboxed preload: only contextBridge + ipcRenderer. This object is the renderer's entire API.
import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type AgentDeckBridge } from '@shared/bridge'

const bridge: AgentDeckBridge = {
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo)
}

contextBridge.exposeInMainWorld('agentdeck', bridge)
