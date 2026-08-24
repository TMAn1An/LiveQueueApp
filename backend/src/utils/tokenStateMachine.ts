import type { TokenStatus } from '@prisma/client';
import { AppError } from './AppError';

/**
 * Centralized transition table (spec section 2.3). Never validate token
 * transitions in a controller — every mutation path routes through
 * assertValidTransition so the rules can't drift between endpoints.
 */
const ALLOWED_TRANSITIONS: Record<TokenStatus, TokenStatus[]> = {
  WAITING: ['CALLED', 'SKIPPED'],
  CALLED: ['IN_PROGRESS', 'SKIPPED'],
  IN_PROGRESS: ['COMPLETED', 'SKIPPED'],
  COMPLETED: [],
  // A deliberate staff Recall (spec: Skipped Token Recall) — the only path
  // back out of SKIPPED. Goes straight to CALLED, not WAITING: the customer
  // already earned their position; recall re-announces them rather than
  // making them wait through the line again (approved design decision).
  SKIPPED: ['CALLED'],
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
