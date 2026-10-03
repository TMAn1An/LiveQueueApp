/**
 * ADR-070: an ordered service journey — the services a person takes, in the
 * order they take them. A copy of backend/src/services/journey.service.ts's
 * validateJourneySteps, so the dashboard and the portal can explain a
 * problem while someone arranges the steps; the backend is what enforces it.
 */

export const MAX_JOURNEY_STEPS = 20;
export const DEFAULT_MAX_OCCURRENCES = 2;

export interface JourneyService {
  id: string;
  name: string;
  /** How often one journey may include it; default 2. */
  maxOccurrencesPerJourney?: number;
}

export interface JourneyProblem {
  code: 'JOURNEY_EMPTY' | 'JOURNEY_TOO_LONG' | 'JOURNEY_CONSECUTIVE_REPEAT' | 'JOURNEY_REPEAT_LIMIT';
  message: string;
  /** 1-based step the problem is at, when it is about one step. */
  stepNumber?: number;
}

function limitOf(service: JourneyService | undefined): number {
  return service?.maxOccurrencesPerJourney ?? DEFAULT_MAX_OCCURRENCES;
}

/** Every rule the steps break, in order (empty = fine). */
export function journeyProblems(
  steps: string[],
  services: JourneyService[],
  { allowEmpty = false }: { allowEmpty?: boolean } = {},
): JourneyProblem[] {
  const byId = new Map(services.map((s) => [s.id, s]));
  const nameOf = (id: string) => byId.get(id)?.name ?? 'This service';
  const problems: JourneyProblem[] = [];
  if (steps.length === 0 && !allowEmpty) {
    problems.push({ code: 'JOURNEY_EMPTY', message: 'Select at least one service.' });
  }
  if (steps.length > MAX_JOURNEY_STEPS) {
    problems.push({ code: 'JOURNEY_TOO_LONG', message: `A journey can have at most ${MAX_JOURNEY_STEPS} steps.` });
  }
  for (let i = 1; i < steps.length; i++) {
    if (steps[i] === steps[i - 1]) {
      problems.push({
        code: 'JOURNEY_CONSECUTIVE_REPEAT',
        message: `${nameOf(steps[i]!)} can't be two steps in a row.`,
        stepNumber: i + 1,
      });
    }
  }
  const counts = new Map<string, number>();
  for (const id of steps) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const [id, count] of counts) {
    const limit = limitOf(byId.get(id));
    if (count > limit) {
      problems.push({
        code: 'JOURNEY_REPEAT_LIMIT',
        message: `${nameOf(id)} can be chosen at most ${limit} ${limit === 1 ? 'time' : 'times'}.`,
      });
    }
  }
  return problems;
}

/** Whether adding `serviceId` at the end keeps the journey valid. */
export function canAppendStep(steps: string[], serviceId: string, services: JourneyService[]): boolean {
  if (steps.length >= MAX_JOURNEY_STEPS) return false;
  if (steps[steps.length - 1] === serviceId) return false;
  const used = steps.filter((id) => id === serviceId).length;
  return used < limitOf(services.find((s) => s.id === serviceId));
}

/** `steps` with the item at `from` moved to `to`. */
export function moveStep<T>(steps: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= steps.length || to < 0 || to >= steps.length) return steps;
  const next = [...steps];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}
