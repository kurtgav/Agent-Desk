/*
 * Runs in <head> before the stylesheet, so the first paint is already in the right theme. It is a file, not an inline
 * script, because the page's policy is script-src 'self' (ADR-0010). Keep it in step with lib/theme.ts: the same key,
 * the same rule (an explicit choice wins, anything else follows the OS), and no more code than that.
 */
/* global localStorage, window, document */
;(function () {
  var choice = null
  try {
    choice = localStorage.getItem('agentdeck.theme')
  } catch {
    // Storage blocked or cleared: follow the OS until main answers.
  }
  var dark = choice === 'dark' || (choice !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  var root = document.documentElement
  root.dataset.theme = dark ? 'dark' : 'light'
  root.style.colorScheme = dark ? 'dark' : 'light'
})()
