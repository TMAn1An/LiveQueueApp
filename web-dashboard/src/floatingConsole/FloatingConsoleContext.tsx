import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FloatingCounterConsole } from './FloatingCounterConsole';
import { copyStyles, isDocumentPipSupported, mirrorTheme, requestPipWindow } from './documentPip';
import { FloatingConsoleContext, type Surface } from './useFloatingConsole';

interface PipSession {
  win: Window;
  container: HTMLElement;
  cleanup: () => void;
}

/**
 * ADR-072: one Floating Counter Console per dashboard tab.
 *
 * Mounted inside the signed-in layout, so it exists only while a session
 * does: signing out (or a revoked session being signed out) unmounts it,
 * which closes the PiP window.
 *
 * With Document Picture-in-Picture the console is a React portal into the
 * PiP window — same React tree, so the same session, data cache and
 * Socket.io connection as the dashboard. Without it, the console is a small
 * dock inside the dashboard, which says plainly that it is not always-on-top.
 * Opening again reuses (focuses) the console that is already open.
 */
export function FloatingConsoleProvider({ children }: { children: ReactNode }) {
  const [surface, setSurface] = useState<Surface | null>(null);
  const [pip, setPip] = useState<PipSession | null>(null);
  const pipRef = useRef<PipSession | null>(null);
  const openingRef = useRef(false);
  const pipSupported = isDocumentPipSupported();

  const endPip = useCallback((closeWindow: boolean) => {
    const session = pipRef.current;
    pipRef.current = null;
    setPip(null);
    if (!session) return;
    session.cleanup();
    if (closeWindow && !session.win.closed) session.win.close();
  }, []);

  const open = useCallback(() => {
    if (pipRef.current && !pipRef.current.win.closed) {
      pipRef.current.win.focus();
      return;
    }
    if (surface === 'dock' || openingRef.current) return;
    if (!pipSupported) {
      setSurface('dock');
      return;
    }
    openingRef.current = true;
    // Called synchronously inside the click: the browser requires it.
    requestPipWindow()
      .then((win) => {
        const doc = win.document;
        doc.title = 'LiveQueue — Counter console';
        copyStyles(document, doc);
        const stopTheme = mirrorTheme(document, doc);
        doc.body.className = document.body.className;
        doc.body.style.margin = '0';
        const container = doc.createElement('div');
        doc.body.appendChild(container);
        // The person closed the window (its own ✕, or the browser).
        const onPageHide = () => {
          endPip(false);
          setSurface((s) => (s === 'pip' ? null : s));
        };
        win.addEventListener('pagehide', onPageHide);
        const session: PipSession = {
          win,
          container,
          cleanup: () => {
            win.removeEventListener('pagehide', onPageHide);
            stopTheme();
            container.remove();
          },
        };
        pipRef.current = session;
        setPip(session);
        setSurface('pip');
      })
      .catch(() => {
        // Refused or failed (no gesture, a policy, another PiP): still give
        // the person a console, on the page.
        setSurface('dock');
      })
      .finally(() => {
        openingRef.current = false;
      });
  }, [endPip, pipSupported, surface]);

  const close = useCallback(() => {
    endPip(true);
    setSurface(null);
  }, [endPip]);

  // Signed out, session lost or the layout left: never leave a console behind.
  useEffect(() => () => endPip(true), [endPip]);

  return (
    <FloatingConsoleContext.Provider value={{ surface, pipSupported, open, close }}>
      {children}
      {surface === 'pip' &&
        pip &&
        createPortal(<FloatingCounterConsole surface="pip" onClose={close} />, pip.container)}
      {surface === 'dock' && (
        <div
          className="fixed bottom-4 right-4 z-40 w-[340px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border shadow-lg"
          data-testid="floating-console-dock"
        >
          <FloatingCounterConsole surface="dock" onClose={close} />
          <p className="border-t border-border bg-subtle/60 px-3 py-1.5 text-[11px] text-muted">
            {pipSupported
              ? 'Shown on this page because the floating window could not be opened.'
              : 'This browser can’t keep the console on top of other windows, so it stays on this page.'}
          </p>
        </div>
      )}
    </FloatingConsoleContext.Provider>
  );
}
