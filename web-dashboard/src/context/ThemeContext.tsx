import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'livequeue-theme';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Reads the starting theme once, in priority order:
 *
 *  1. the operator's own saved choice — an explicit decision outranks
 *     everything, including a later OS change;
 *  2. the operating system's `prefers-color-scheme`, so a machine already
 *     set to dark does not flash a white dashboard on first visit;
 *  3. light, the dashboard's existing default.
 *
 * Storage is wrapped because a locked-down browser profile can throw on
 * access, and a theme preference is never worth failing a render over.
 */
function readInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
  } catch {
    // Unreadable storage is treated exactly like "nothing saved".
  }

  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

/**
 * Owns the dashboard's light/dark choice. Purely client-side: no account
 * field, no API call, no migration — the preference belongs to the browser
 * the operator is sitting at, not to their LiveQueue identity.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    // The class on <html> is what every `dark:` style and the semantic
    // tokens in index.css key off — one switch for the whole app.
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // A theme that cannot be remembered still applies for this session.
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  return <ThemeContext value={{ theme, toggleTheme }}>{children}</ThemeContext>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
