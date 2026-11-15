import { useMemo } from 'react'
import type { RoleSummary } from '@shared/roles'
import { useRolesCatalog } from '../roles/store'

/** Roles by id, for the emoji and name beside a session. Empty until the catalog has loaded; a session still shows without it. */
export function useRoleIndex(): ReadonlyMap<string, RoleSummary> {
  const { catalog } = useRolesCatalog()
  return useMemo(() => new Map((catalog?.roles ?? []).map((r) => [r.id, r])), [catalog])
}
