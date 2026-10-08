/**
 * ADR-072: only harmless presentation preferences are remembered. Nothing
 * operational (counter, token, permissions) is ever stored — that always
 * comes live from the backend.
 */
export type ConsoleMode = 'compact' | 'expanded';

const MODE_KEY = 'livequeue.floatingConsole.mode';

export function readConsoleMode(): ConsoleMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'expanded' ? 'expanded' : 'compact';
  } catch {
    return 'compact';
  }
}

export function writeConsoleMode(mode: ConsoleMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Storage unavailable (private mode, blocked): the choice just isn't kept.
  }
}
