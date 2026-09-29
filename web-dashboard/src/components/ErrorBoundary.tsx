import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './Button';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Last-resort fallback for an uncaught render error anywhere below it.
 * Every expected failure (a failed API call, a validation error) already has
 * its own safe message via actionErrorMessage/ApiError — this exists only
 * for the unexpected case those never cover: a genuine bug throwing during
 * render, which React would otherwise unmount to a blank page with no
 * explanation (spec section 25 — no negative result may be silent).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Never shown to the user — this is the one place a stack trace is
    // acceptable, since it never leaves the developer's own console.
    console.error('Unhandled dashboard error', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-page px-4">
          <div className="max-w-sm text-center">
            <h1 className="text-lg font-semibold text-fg">Something went wrong</h1>
            <p className="mt-2 text-sm text-muted">
              An unexpected error occurred. Reloading the page usually fixes this.
            </p>
            <Button className="mt-4" onClick={() => window.location.reload()}>
              Reload page
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
