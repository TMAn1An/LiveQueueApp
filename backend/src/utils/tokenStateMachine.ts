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
  // A deliberate staff Recall (spec: Skipped Token Recall) — the only path
  // back out of SKIPPED. Goes straight to CALLED, not WAITING: the customer
  // already earned their position; recall re-announces them rather than
  // making them wait through the line again (approved design decision).
  SKIPPED: ['CALLED'],
  // V2 Checkpoint 7: terminal, and deliberately NOT recallable (unlike
  // SKIPPED) — cancellation is intentional abandonment; a customer who wants
  // service again must create a new token, subject to the queue's own
  // policies (allowRepeatVisits does not apply here — only COMPLETED
  // consumes that allowance, see token.service.ts::createToken).
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
