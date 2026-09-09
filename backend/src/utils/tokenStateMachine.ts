import type { TokenStatus } from '@prisma/client';
import { AppError } from './AppError';

/**
 * Centralized transition table (spec section 2.3). Never validate token
 * transitions in a controller — every mutation path routes through
 * assertValidTransition so the rules can't drift between endpoints.
 */
const ALLOWED_TRANSITIONS: Record<TokenStatus, TokenStatus[]> = {
  // V2 Checkpoint 7: customer cancellation is allowed only up to the moment
  // service actually begins — WAITING and CALLED, never IN_PROGRESS or later.
  WAITING: ['CALLED', 'SKIPPED', 'CANCELLED'],
  CALLED: ['IN_PROGRESS', 'SKIPPED', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'SKIPPED'],
  COMPLETED: [],
  // V2 UX + Token Lifecycle checkpoint: SKIPPED is terminal — Recall
  // (SKIPPED -> CALLED) has been removed. A skipped customer must scan the
  // queue QR again and receive a new token, subject to the queue's own
  // repeat-visit policy (skipping never consumed that allowance, so a
  // rejoin is always permitted purely on the strength of having been
  // skipped).
  SKIPPED: [],
  // V2 Checkpoint 7: terminal, for the same reason as SKIPPED above —
  // cancellation is intentional abandonment; a customer who wants service
  // again must create a new token, subject to the queue's own policies
  // (allowRepeatVisits does not apply here — only COMPLETED consumes that
  // allowance, see token.service.ts::createToken).
  CANCELLED: [],
};

export function assertValidTransition(current: TokenStatus, next: TokenStatus): void {
  if (!ALLOWED_TRANSITIONS[current].includes(next)) {
    throw new AppError(
      422,
      'INVALID_TOKEN_TRANSITION',
      `Cannot transition token from ${current} to ${next}.`,
    );
  }
}
