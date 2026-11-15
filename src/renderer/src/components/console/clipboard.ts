/** The OS clipboard through the bridge (the sandboxed page has no `navigator.clipboard`); a plain browser (the demo preview) falls back to it. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (window.agentdeck) return (await window.agentdeck.copyText(text)).ok
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
