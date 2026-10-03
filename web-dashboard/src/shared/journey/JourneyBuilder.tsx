import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  DEFAULT_MAX_OCCURRENCES,
  MAX_JOURNEY_STEPS,
  canAppendStep,
  journeyProblems,
  moveStep,
  type JourneyService,
} from './journeyRules';

/**
 * ADR-070: arrange services into an ordered journey. Used by the dashboard
 * (an Admin's recommended order) and the portal (a person choosing their
 * steps before joining).
 *
 * Reordering works three ways, all equivalent:
 *  - drag a step by its handle — pointer events, so mouse, pen and touch
 *    all behave the same (HTML5 drag-and-drop does not work on touch);
 *  - focus a handle and press ↑ / ↓;
 *  - the "Move up" / "Move down" buttons.
 * Steps are numbered automatically, and every move is announced.
 */
export function JourneyBuilder({
  services,
  steps,
  onChange,
  allowEmpty = false,
  disabled = false,
  idPrefix = 'journey',
  emptyMessage = 'No steps yet. Add a service below.',
  addLabel = 'Add',
}: {
  services: JourneyService[];
  steps: string[];
  onChange: (steps: string[]) => void;
  /** The recommended order may be empty (no suggestion); a person's may not. */
  allowEmpty?: boolean;
  disabled?: boolean;
  idPrefix?: string;
  emptyMessage?: string;
  addLabel?: string;
}) {
  const byId = new Map(services.map((s) => [s.id, s]));
  const nameOf = (id: string) => byId.get(id)?.name ?? 'Unavailable service';
  const problems = journeyProblems(steps, services, { allowEmpty });
  const badSteps = new Set(problems.map((p) => p.stepNumber).filter((n): n is number => n !== undefined));

  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const handleRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');
  // The drag follows the pointer on the window, not on the handle: the
  // handle's row moves in the DOM while it is dragged, which would end a
  // pointer capture taken on it. Latest values live in refs for the listeners.
  const dragRef = useRef<number | null>(null);
  const latest = useRef({ steps, onChange });
  useEffect(() => {
    latest.current = { steps, onChange };
  });
  const stopDragRef = useRef<() => void>(() => undefined);
  useEffect(() => () => stopDragRef.current(), []);

  function move(from: number, to: number, focus = false) {
    if (to < 0 || to >= steps.length || from === to) return;
    onChange(moveStep(steps, from, to));
    setAnnouncement(`${nameOf(steps[from]!)} moved to step ${to + 1} of ${steps.length}.`);
    // Keep the keyboard on the step that moved, once it has re-rendered.
    if (focus) requestAnimationFrame(() => handleRefs.current[to]?.focus());
  }

  function indexAt(clientY: number): number {
    const rects = itemRefs.current.slice(0, steps.length).map((el) => el?.getBoundingClientRect());
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (r && clientY < r.top + r.height / 2) return i;
    }
    return steps.length - 1;
  }

  function onPointerDown(e: PointerEvent<HTMLButtonElement>, index: number) {
    if (disabled || e.button > 0) return;
    e.preventDefault();
    dragRef.current = index;
    setDragIndex(index);
    const pointerId = e.pointerId;

    const onMove = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== pointerId || dragRef.current === null) return;
      const from = dragRef.current;
      const over = indexAt(ev.clientY);
      if (over !== from) {
        const { steps: current, onChange: change } = latest.current;
        change(moveStep(current, from, over));
        dragRef.current = over;
        setDragIndex(over);
      }
    };
    const onUp = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const at = dragRef.current;
      stop();
      if (at !== null) {
        const { steps: current } = latest.current;
        setAnnouncement(`${nameOf(current[at]!)} is now step ${at + 1} of ${current.length}.`);
      }
    };
    function stop() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      dragRef.current = null;
      setDragIndex(null);
      stopDragRef.current = () => undefined;
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    stopDragRef.current = stop;
  }

  function onHandleKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (disabled) return;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(index, index - 1, true);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(index, index + 1, true);
    }
  }

  function remove(index: number) {
    const removed = steps[index]!;
    onChange(steps.filter((_, i) => i !== index));
    setAnnouncement(`${nameOf(removed)} removed.`);
  }

  function append(serviceId: string) {
    onChange([...steps, serviceId]);
    setAnnouncement(`${nameOf(serviceId)} added as step ${steps.length + 1}.`);
  }

  const smallButton =
    'inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-border px-2 text-xs font-medium text-fg-soft transition-colors hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div className="space-y-3">
      {steps.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted">
          {emptyMessage}
        </p>
      ) : (
        <ol aria-label="Steps in order" className="space-y-2">
          {steps.map((serviceId, index) => {
            const name = nameOf(serviceId);
            const invalid = badSteps.has(index + 1);
            // Steps may repeat: "the 2nd Lab step" is a stable identity across
            // moves, so a row (and the handle being dragged) is never remounted.
            const occurrence = steps.slice(0, index).filter((id) => id === serviceId).length;
            return (
              <li
                key={`${serviceId}#${occurrence}`}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                data-dragging={dragIndex === index ? 'true' : undefined}
                aria-invalid={invalid ? true : undefined}
                className={`flex items-center gap-2 rounded-lg border bg-surface px-2 py-2 shadow-sm transition-shadow ${
                  dragIndex === index ? 'border-brand-500 shadow-md ring-2 ring-brand-200' : 'border-border'
                } ${invalid ? 'border-red-500' : ''}`}
              >
                <button
                  type="button"
                  ref={(el) => {
                    handleRefs.current[index] = el;
                  }}
                  disabled={disabled}
                  aria-label={`Reorder step ${index + 1}, ${name}. Use the up and down arrow keys to move it.`}
                  onPointerDown={(e) => onPointerDown(e, index)}
                  onKeyDown={(e) => onHandleKeyDown(e, index)}
                  style={{ touchAction: 'none' }}
                  className="flex h-9 w-8 shrink-0 cursor-grab items-center justify-center rounded-md text-faint hover:bg-subtle hover:text-fg active:cursor-grabbing disabled:cursor-not-allowed"
                >
                  <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <circle cx="7" cy="5" r="1.5" />
                    <circle cx="13" cy="5" r="1.5" />
                    <circle cx="7" cy="10" r="1.5" />
                    <circle cx="13" cy="10" r="1.5" />
                    <circle cx="7" cy="15" r="1.5" />
                    <circle cx="13" cy="15" r="1.5" />
                  </svg>
                </button>
                <span
                  aria-hidden="true"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white"
                >
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                  <span className="sr-only">Step {index + 1}: </span>
                  {name}
                </span>
                <button
                  type="button"
                  className={smallButton}
                  disabled={disabled || index === 0}
                  onClick={() => move(index, index - 1)}
                  aria-label={`Move ${name} up`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={smallButton}
                  disabled={disabled || index === steps.length - 1}
                  onClick={() => move(index, index + 1)}
                  aria-label={`Move ${name} down`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className={smallButton}
                  disabled={disabled}
                  onClick={() => remove(index)}
                  aria-label={`Remove step ${index + 1}, ${name}`}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {problems.length > 0 && (
        <ul role="alert" className="space-y-1 text-xs font-medium text-red-600 dark:text-red-400">
          {problems.map((p) => (
            <li key={`${p.code}-${p.stepNumber ?? p.message}`}>{p.message}</li>
          ))}
        </ul>
      )}

      <div>
        <p id={`${idPrefix}-add-label`} className="mb-1.5 text-xs font-medium text-muted">
          {addLabel} a step ({steps.length}/{MAX_JOURNEY_STEPS})
        </p>
        <div role="group" aria-labelledby={`${idPrefix}-add-label`} className="flex flex-wrap gap-2">
          {services.map((service) => {
            const used = steps.filter((id) => id === service.id).length;
            const limit = service.maxOccurrencesPerJourney ?? DEFAULT_MAX_OCCURRENCES;
            const allowed = !disabled && canAppendStep(steps, service.id, services);
            return (
              <button
                key={service.id}
                type="button"
                disabled={!allowed}
                onClick={() => append(service.id)}
                aria-label={`${addLabel} ${service.name} (${used} of ${limit} used)`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium text-fg transition-colors hover:border-brand-500 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-brand-950/40"
              >
                <span aria-hidden="true">+</span>
                {service.name}
                {used > 0 && (
                  <span aria-hidden="true" className="text-faint">
                    {used}/{limit}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
