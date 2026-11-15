; Custom steps for the electron-builder NSIS installer (ADR-0012).
;
; customUnInstall runs inside the uninstall section BEFORE electron-builder deletes the install folder
; (app-builder-lib templates/nsis/uninstaller.nsh), so AgentDeck.exe is still there to call.
;
; `--uninstall-integration` must remove only AgentDeck's own hook and OTel entries from the user's
; settings.json and exit without opening a window (ADR-0005, ADR-0007). It is capped at 10 s, so a
; build that ignores the flag cannot hang the uninstall. A failure here never blocks the uninstall:
; AgentDeck also removes the entries itself every time it quits cleanly.
; App data in %APPDATA%\AgentDeck is kept (the uninstaller accepts --delete-app-data to remove it).
!macro customUnInstall
  nsExec::Exec /TIMEOUT=10000 '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --uninstall-integration'
  Pop $0
!macroend
