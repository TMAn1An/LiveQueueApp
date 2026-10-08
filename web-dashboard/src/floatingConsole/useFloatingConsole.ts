import { createContext, useContext } from 'react';

export type Surface = 'pip' | 'dock';

export interface FloatingConsoleApi {
  /** Where the console is showing, or null when closed. */
  surface: Surface | null;
  /** Document Picture-in-Picture is available in this browser. */
  pipSupported: boolean;
  /** Must be called from a click: the browser only opens PiP on a gesture. */
  open: () => void;
  close: () => void;
}

export const FloatingConsoleContext = createContext<FloatingConsoleApi | null>(null);

/** ADR-072: null outside the signed-in layout (no console can be opened there). */
export function useFloatingConsole(): FloatingConsoleApi | null {
  return useContext(FloatingConsoleContext);
}
