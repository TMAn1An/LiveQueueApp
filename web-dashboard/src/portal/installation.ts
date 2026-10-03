/**
 * ADR-068: the browser installation identity.
 *
 * A cryptographically random UUID, created once per browser profile and kept
 * in this origin's storage. It identifies a browser installation — never a
 * person — and is what the backend calls the device: one active visit per
 * installation per queue, and where pushes for its visits go. No
 * fingerprinting of any kind (no hardware, canvas, fonts, IP).
 *
 * Clearing website data, Private Browsing, or another device all give a new
 * id, as expected. Queues that must recognise the same person across those
 * use verified email, which is separate from this id.
 *
 * Home Screen web apps on iOS get their own storage, separate from the
 * Safari tab they were added from. So that the visit joined in Safari keeps
 * its notifications after being added to the Home Screen, the page being
 * added carries the id once in its URL (`?install=`), and the Home Screen
 * app adopts it on first launch and removes it from the address.
 */

const INSTALLATION_KEY = 'livequeue.portal.browserInstallationId';
const VISITS_KEY = 'livequeue.portal.visits';
export const INSTALL_PARAM = 'install';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage refused (e.g. disabled): the id simply lives for this page */
  }
}

let memoryId: string | null = null;

export function newUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getBrowserInstallationId(): string {
  const stored = read(INSTALLATION_KEY);
  if (stored && UUID.test(stored)) return stored;
  if (memoryId) {
    // Storage was cleared while the page stayed open: keep this page's id.
    write(INSTALLATION_KEY, memoryId);
    return memoryId;
  }
  const created = newUuid();
  memoryId = created;
  write(INSTALLATION_KEY, created);
  return created;
}

/**
 * On a Home Screen launch, adopt the id carried in the start URL — only when
 * this storage has none of its own yet — and strip it from the address bar.
 */
export function adoptInstallationFromUrl(location: Location, history: History): void {
  const params = new URLSearchParams(location.search);
  const carried = params.get(INSTALL_PARAM);
  if (!carried) return;
  if (UUID.test(carried) && !read(INSTALLATION_KEY)) {
    write(INSTALLATION_KEY, carried);
    memoryId = carried;
  }
  params.delete(INSTALL_PARAM);
  const query = params.toString();
  history.replaceState(history.state, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
}

/** The address to add to the Home Screen from: this page, carrying the id. */
export function urlCarryingInstallation(location: Location): string {
  const params = new URLSearchParams(location.search);
  params.set(INSTALL_PARAM, getBrowserInstallationId());
  return `${location.pathname}?${params.toString()}`;
}

export interface RememberedVisit {
  tokenId: string;
  serialNumber: string;
  queueName: string;
  organizationCode: string | null;
  joinedAt: string;
}

export function rememberedVisits(): RememberedVisit[] {
  try {
    const parsed = JSON.parse(read(VISITS_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as RememberedVisit[]).filter((v) => typeof v?.tokenId === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberVisit(visit: RememberedVisit): void {
  const others = rememberedVisits().filter((v) => v.tokenId !== visit.tokenId);
  write(VISITS_KEY, JSON.stringify([visit, ...others].slice(0, 20)));
}

export function forgetVisit(tokenId: string): void {
  write(VISITS_KEY, JSON.stringify(rememberedVisits().filter((v) => v.tokenId !== tokenId)));
}
