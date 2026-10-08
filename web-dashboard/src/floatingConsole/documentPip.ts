/**
 * ADR-072: Document Picture-in-Picture (not video PiP). A small,
 * browser-controlled, always-on-top window whose document this app renders
 * into with a React portal — so it shares the dashboard's session, data cache
 * and single Socket.io connection instead of starting its own.
 *
 * Feature-detected, never sniffed from the user agent.
 */

interface DocumentPictureInPicture {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
  readonly window: Window | null;
}

function api(): DocumentPictureInPicture | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as unknown as { documentPictureInPicture?: DocumentPictureInPicture })
    .documentPictureInPicture;
  return candidate && typeof candidate.requestWindow === 'function' ? candidate : null;
}

export function isDocumentPipSupported(): boolean {
  return api() !== null;
}

/** Initial size: fits the compact console; the person can resize it. */
export const PIP_SIZE = { width: 340, height: 300 };

/**
 * Must be called synchronously from a user gesture (a click) — the browser
 * refuses otherwise. Reuses a PiP window this page already has open.
 */
export function requestPipWindow(): Promise<Window> {
  const pip = api();
  if (!pip) return Promise.reject(new Error('Document Picture-in-Picture is not supported.'));
  if (pip.window && !pip.window.closed) return Promise.resolve(pip.window);
  return pip.requestWindow(PIP_SIZE);
}

/**
 * Gives the PiP document the dashboard's styles: every stylesheet <link> and
 * <style> is cloned (Vite injects <style> in development and <link> in a
 * build). Nothing is fetched from anywhere new, and no CSP is relaxed.
 */
export function copyStyles(from: Document, to: Document): void {
  for (const node of from.head.querySelectorAll('link[rel="stylesheet"], style')) {
    const clone = node.cloneNode(true) as HTMLElement;
    // The PiP document's URL is about:blank, so a relative href would point
    // nowhere: use the URL the dashboard itself resolved.
    if (node instanceof from.defaultView!.HTMLLinkElement) (clone as HTMLLinkElement).href = node.href;
    to.head.appendChild(clone);
  }
}

/**
 * Keeps the PiP document's light/dark theme in step with the dashboard's
 * (ThemeContext toggles `dark` on <html>). Returns the cleanup.
 */
export function mirrorTheme(from: Document, to: Document): () => void {
  const apply = () => to.documentElement.classList.toggle('dark', from.documentElement.classList.contains('dark'));
  apply();
  const view = from.defaultView;
  if (!view || typeof view.MutationObserver !== 'function') return () => undefined;
  const observer = new view.MutationObserver(apply);
  observer.observe(from.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });
  return () => observer.disconnect();
}
