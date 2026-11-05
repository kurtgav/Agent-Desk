import { Menu, Tray, nativeImage } from 'electron'

export function createTray(iconPath: string, title: string, actions: { open: () => void; quit: () => void }): Tray {
  // createFromPath picks up tray@2x.png next to tray.png for high-DPI.
  const tray = new Tray(nativeImage.createFromPath(iconPath))
  tray.setToolTip(title)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open AgentDeck', click: actions.open },
      { type: 'separator' },
      { label: 'Quit AgentDeck', click: actions.quit }
    ])
  )
  tray.on('click', actions.open)
  tray.on('double-click', actions.open)
  return tray
}
