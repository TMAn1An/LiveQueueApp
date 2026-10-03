/**
 * ADR-068: who the portal is for.
 *
 * The portal is the iPhone/iPad way into LiveQueue — Android has the app,
 * and Web Push on iOS only works for a Home Screen web app opened from
 * Safari's Share sheet. This sorts a visitor into one of five kinds so the
 * portal can welcome Safari and point everyone else the right way.
 *
 * This is a product gate, NOT a security boundary: the User-Agent is
 * whatever the client says it is. The backend never trusts it, and nothing
 * here grants or denies access to data.
 */

export type BrowserKind =
  /** Safari on iPhone/iPad (including iPadOS's desktop-class Safari). */
  | 'ios-safari'
  /** The portal opened from the Home Screen (standalone web app). */
  | 'ios-standalone'
  /** Another browser or an in-app web view on iPhone/iPad. */
  | 'ios-other'
  | 'android'
  | 'desktop';

export interface BrowserSignals {
  userAgent: string;
  /** iPadOS Safari reports a Mac User-Agent; touch points tell them apart. */
  maxTouchPoints: number;
  /** navigator.standalone (iOS) or display-mode: standalone. */
  standalone: boolean;
}

const NON_SAFARI_IOS = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|YaBrowser|GSA\/|DuckDuckGo|Brave|FBAN|FBAV|Instagram|Line\/|Snapchat|MicroMessenger/;

export function classifyBrowser({ userAgent, maxTouchPoints, standalone }: BrowserSignals): BrowserKind {
  if (/Android/i.test(userAgent)) return 'android';
  const isIOS = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  if (!isIOS) return 'desktop';
  if (standalone) return 'ios-standalone';
  if (NON_SAFARI_IOS.test(userAgent)) return 'ios-other';
  // Safari carries "Version/x" and "Safari/"; in-app web views usually do not.
  if (/Version\/\d+/.test(userAgent) && /Safari\//.test(userAgent)) return 'ios-safari';
  return 'ios-other';
}

export function isPortalAllowed(kind: BrowserKind): boolean {
  return kind === 'ios-safari' || kind === 'ios-standalone';
}

/** iOS/iPadOS major version, when the User-Agent says so. */
export function iosMajorVersion(userAgent: string): number | null {
  const os = /OS (\d+)[_.]\d+/.exec(userAgent);
  if (os && /iPhone|iPad|iPod/.test(userAgent)) return Number(os[1]);
  const safari = /Version\/(\d+)/.exec(userAgent);
  return safari ? Number(safari[1]) : null;
}

export function currentBrowserSignals(): BrowserSignals {
  const nav = navigator as Navigator & { standalone?: boolean };
  const standalone =
    nav.standalone === true ||
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
  return { userAgent: nav.userAgent, maxTouchPoints: nav.maxTouchPoints ?? 0, standalone };
}

export const GATE_MESSAGES: Record<Exclude<BrowserKind, 'ios-safari' | 'ios-standalone'>, { title: string; body: string }> = {
  android: {
    title: 'LiveQueue for Android is available through the Android app.',
    body: 'Open the LiveQueue app and scan this QR code there to join a queue.',
  },
  'ios-other': {
    title: 'Open this link in Safari to use LiveQueue.',
    body: 'Copy the link, or tap the menu and choose “Open in Safari”. Live updates and notifications work in Safari.',
  },
  desktop: {
    title: 'This portal is designed for iPhone and iPad.',
    body: 'Scan the QR code with your iPhone or iPad camera, or use the LiveQueue app on Android.',
  },
};
