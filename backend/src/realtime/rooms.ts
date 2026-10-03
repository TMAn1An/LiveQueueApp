/**
 * The rooms defined by the specification (section 8) — approved Phase 4
 * decision 2 — plus the ADR-069 staff rooms that keep Admin workspaces apart.
 */

/** Organization-wide staff room: only the Organization Head and Managers
 * join it (ADR-069). */
export function organizationRoom(organizationId: string): string {
  return `organization:${organizationId}`;
}

export function queueRoom(queueId: string): string {
  return `queue:${queueId}`;
}

export function tokenRoom(tokenId: string): string {
  return `token:${tokenId}`;
}

/** ADR-069: one Admin's workspace — that Admin and their Executives. */
export function workspaceRoom(adminId: string): string {
  return `workspace:${adminId}`;
}

/** ADR-069: queues without an Admin (legacy, Head-managed) — the
 * organization-level Executives who serve them. */
export function legacyWorkspaceRoom(organizationId: string): string {
  return `workspace-legacy:${organizationId}`;
}

/** ADR-069: staff events for one queue, for someone serving there from
 * outside its workspace (a legacy counter assignment). */
export function staffQueueRoom(queueId: string): string {
  return `staff-queue:${queueId}`;
}
