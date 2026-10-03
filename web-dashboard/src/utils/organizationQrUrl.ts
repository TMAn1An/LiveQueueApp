/** Where the public portal lives: its own origin when configured, else this one. */
export function organizationQrUrl(publicCode: string, origin = portalOrigin()): string {
  return `${origin.replace(/\/+$/, '')}/visit/${publicCode}`;
}

function portalOrigin(): string {
  const configured = (import.meta.env.VITE_PUBLIC_PORTAL_URL as string | undefined)?.trim();
  return configured || window.location.origin;
}
