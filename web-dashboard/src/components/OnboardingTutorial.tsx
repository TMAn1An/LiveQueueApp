import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from './Button';
import { useCompleteOnboarding } from '../hooks/useOrganization';

interface Step {
  title: string;
  body: string;
  cta?: { label: string; to: string };
}

/**
 * The eleven-step sequence a new owner is walked through (V2 Product
 * Completion checkpoint, Part C) — the minimum path to a queue a customer
 * can actually join. Deliberately informational rather than gated on
 * detecting that each action happened: several of these (services, counters,
 * the customer form, identity policy, the QR code) live on a queue's own
 * settings page, which does not exist as a target until step 2 is done, so
 * this can only ever *point* the owner there and let them click Next
 * themselves — trying to synchronously verify completion would mean either
 * blocking on a poll of data that may never arrive, or silently pretending
 * to. The dashboard stays fully usable underneath at every step.
 */
const STEPS: Step[] = [
  {
    title: 'Welcome to LiveQueue',
    body: 'A short guide to the minimum path from an empty organization to a queue your customers can actually join. Skip anytime — nothing here is required.',
  },
  {
    title: 'Create your first queue',
    body: 'A queue is one service line — a pharmacy counter, a registration desk. Give it a name and a token prefix.',
    cta: { label: 'Go to Queues', to: '/queues' },
  },
  {
    title: 'Add services',
    body: 'Open your new queue’s settings and list what it offers, each with its own expected duration. A customer selects one (or more) when joining.',
    cta: { label: 'Go to Queues', to: '/queues' },
  },
  {
    title: 'Add counters',
    body: 'A counter is where staff actually serve someone. A queue with no active counter has nowhere to send a called customer, so add at least one.',
    cta: { label: 'Go to Queues', to: '/queues' },
  },
  {
    title: 'Invite staff',
    body: 'Send an email invitation to the people who will run the counter. They set their own password from the link — nobody types it for them.',
    cta: { label: 'Go to Staff', to: '/staff' },
  },
  {
    title: 'Assign staff to counters',
    body: 'From the queue’s counters page, assign an invited staff member to the counter they’ll work from.',
    cta: { label: 'Go to Queues', to: '/queues' },
  },
  {
    title: 'Configure the customer form',
    body: 'Decide what a customer fills in when joining — a name, a reference number, anything your queue needs — from the queue’s own settings.',
    cta: { label: 'Go to Queues', to: '/queues' },
  },
  {
    title: 'Customer identity & repeat visits',
    body: 'If the same customer should not be able to rejoin immediately after being served, a queue can require a verified email or a custom field to recognise them — also in the queue’s settings.',
    cta: { label: 'Go to Queues', to: '/queues' },
  },
  {
    title: 'Generate the queue QR code',
    body: 'Every queue has its own QR code a customer scans to join — print it, or display it, at the physical location.',
    cta: { label: 'Go to Queues', to: '/queues' },
  },
  {
    title: 'Test the queue',
    body: 'Scan the code with the LiveQueue mobile app (or open the queue’s live view here) and join as a customer would, to see the whole flow once before opening for real.',
  },
  {
    title: "You're ready",
    body: 'That’s the whole minimum path. Everything here stays reachable later — restart this guide anytime from Organization Settings.',
  },
];

export function OnboardingTutorial() {
  const [stepIndex, setStepIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const navigate = useNavigate();
  const completeOnboarding = useCompleteOnboarding();

  if (dismissed) return null;

  const step = STEPS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;

  function finish() {
    // Hidden immediately rather than waiting on the mutation, so a slow or
    // failed request never leaves the guide looking stuck open — completion
    // is a courtesy sync back to the server, not something the owner should
    // have to wait on to be done with the guide.
    setDismissed(true);
    completeOnboarding.mutate();
  }

  return (
    <aside
      role="region"
      aria-label="LiveQueue setup guide"
      className="fixed bottom-4 right-4 z-40 w-full max-w-sm rounded-lg border border-border bg-surface p-4 shadow-lg"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-muted">
          Step {stepIndex + 1} of {STEPS.length}
        </span>
        <button
          type="button"
          onClick={finish}
          aria-label="Dismiss setup guide"
          className="rounded-md p-1 text-faint transition-colors duration-150 hover:bg-subtle hover:text-fg"
        >
          ✕
        </button>
      </div>
      <div className="mb-3 h-1 overflow-hidden rounded-full bg-subtle">
        <div
          className="h-full rounded-full bg-brand-600 transition-all duration-150 dark:bg-brand-500"
          style={{ width: `${((stepIndex + 1) / STEPS.length) * 100}%` }}
        />
      </div>
      <div aria-live="polite">
        <h2 className="mb-1 text-sm font-semibold text-fg">{step.title}</h2>
        <p className="mb-3 text-sm text-fg-soft">{step.body}</p>
        {step.cta && (
          <Button
            variant="secondary"
            className="mb-3"
            onClick={() => navigate(step.cta!.to)}
          >
            {step.cta.label}
          </Button>
        )}
      </div>
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={finish}>
          Skip tutorial
        </Button>
        <div className="flex gap-2">
          {!isFirst && (
            <Button variant="outline" onClick={() => setStepIndex((i) => i - 1)}>
              Back
            </Button>
          )}
          {isLast ? (
            <Button onClick={finish}>Finish</Button>
          ) : (
            <Button onClick={() => setStepIndex((i) => i + 1)}>Next</Button>
          )}
        </div>
      </div>
    </aside>
  );
}
