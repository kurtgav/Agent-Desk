import type { ActionResult } from '@shared/bridge'
import type { CustomRoleInput, RoleDetail, RoleRepoResult, RoleSaveResult, RoleSkillsResult, RolesCatalog } from '@shared/roles'
import { demoRolesApi } from '@/demo/roles'
import { useUi } from '@/store'

/**
 * The page's one door to roles: the preload bridge in the app, in-memory sample data in demo mode and in a plain browser (ADR-0011).
 * Writes never reach disk in demo (D-130). A failed call answers with a sentence, never throws, except `list` and `reload`, whose
 * failure the page shows as its own state.
 */
export interface RolesApi {
  list(): Promise<RolesCatalog>
  reload(): Promise<RolesCatalog>
  get(id: string): Promise<RoleDetail | null>
  save(input: CustomRoleInput): Promise<RoleSaveResult>
  remove(id: string): Promise<ActionResult>
  duplicate(id: string): Promise<RoleSaveResult>
  setPinned(id: string, on: boolean): Promise<string[]>
  /** Install (on) or remove these roles as Claude Code skills. */
  setSkills(ids: string[], on: boolean): Promise<RoleSkillsResult>
  setRepo(path: string | null): Promise<RoleRepoResult>
  browse(): Promise<string | null>
}

export function isRolesDemo(): boolean {
  return useUi.getState().snapshot.mode === 'demo' || !window.agentdeck
}

const FAILED = 'AgentDeck could not reach its roles. Try again.'

const live: RolesApi = {
  list: () => window.agentdeck!.listRoles(),
  reload: () => window.agentdeck!.reloadRoles(),
  get: (id) => window.agentdeck!.getRole(id).catch(() => null),
  save: (input) => window.agentdeck!.saveCustomRole(input).catch((): RoleSaveResult => ({ ok: false, error: FAILED })),
  remove: (id) => window.agentdeck!.deleteCustomRole(id).catch((): ActionResult => ({ ok: false, error: FAILED })),
  duplicate: (id) => window.agentdeck!.duplicateRole(id).catch((): RoleSaveResult => ({ ok: false, error: FAILED })),
  setPinned: (id, on) => window.agentdeck!.setRolePinned(id, on),
  setSkills: (ids, on) =>
    (on ? window.agentdeck!.installRoleSkills(ids) : window.agentdeck!.removeRoleSkills(ids)).catch((): RoleSkillsResult => ({ ok: false, skills: [], error: FAILED })),
  setRepo: (path) => window.agentdeck!.setRolesRepo(path).catch((): RoleRepoResult => ({ ok: false, error: FAILED })),
  browse: () => window.agentdeck!.browseRolesRepo().catch(() => null)
}

export const rolesApi = (): RolesApi => (isRolesDemo() ? demoRolesApi : live)
