/**
 * The three rooms defined by the specification (section 8) — approved
 * Phase 4 decision 2. No other room types exist.
 */
export function organizationRoom(organizationId: string): string {
  return `organization:${organizationId}`;
}

export function queueRoom(queueId: string): string {
  return `queue:${queueId}`;
}

export function tokenRoom(tokenId: string): string {
  return `token:${tokenId}`;
}
