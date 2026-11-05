/** Last path segment of a cwd, either separator. */
export function projectName(cwd: string): string {
  const parts = cwd.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? cwd
}

/** Windows paths are case-insensitive (D-013): one key per file, whatever the casing or separator. */
export function pathKey(p: string): string {
  return p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}
