import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { BrandLogo } from './BrandLogo';
import { Button } from './Button';
import { InlineSpinner } from './Spinner';

/**
 * Shown instead of a protected screen while there is a stored session that
 * the backend could not be reached to confirm (AuthContext `reconnecting`).
 *
 * It says what is true and no more: the server is not answering, the person
 * has not been signed out, and the dashboard is still trying. Nothing behind
 * it is rendered — no page, no cached identity — until the backend answers.
 */
export function SessionReconnecting() {
  const { retrySessionRestore, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  return (
    <div className="flex min-h-screen items-center justify-center bg-subtle px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <BrandLogo variant="full" className="h-auto w-72 max-w-full" />
        </div>
        <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-fg">Can’t reach LiveQueue</h1>
          <p className="mt-2 text-sm text-fg-soft">
            The server isn’t answering, so your session couldn’t be confirmed. You’re still signed in
            on this device.
          </p>
          <p role="status" className="mt-4 flex items-center gap-2 text-sm text-muted">
            <InlineSpinner />
            Reconnecting — this page will continue on its own.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={retrySessionRestore}>Retry now</Button>
            <Button
              variant="ghost"
              loading={signingOut}
              onClick={() => {
                setSigningOut(true);
                void logout();
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
