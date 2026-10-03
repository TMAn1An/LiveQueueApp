import { GATE_MESSAGES, type BrowserKind } from '../browserGate';
import { Card, Shell } from '../ui';

/** ADR-068: a friendly stop for everyone the portal is not built for. */
export function GatePage({ kind }: { kind: Exclude<BrowserKind, 'ios-safari' | 'ios-standalone'> }) {
  const message = GATE_MESSAGES[kind];
  return (
    <Shell>
      <Card>
        <h1 className="text-xl font-bold">{message.title}</h1>
        <p className="mt-2 text-sm text-muted">{message.body}</p>
        {kind === 'ios-other' && (
          <button
            type="button"
            className="mt-4 min-h-12 w-full rounded-xl border border-border-strong text-base font-semibold"
            onClick={() => void navigator.clipboard?.writeText(window.location.href)}
          >
            Copy link
          </button>
        )}
      </Card>
    </Shell>
  );
}
