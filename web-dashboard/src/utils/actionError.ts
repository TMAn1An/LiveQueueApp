import { ApiError } from '../api/client';

/**
 * What to tell staff when a token action fails. A backend refusal already
 * carries a message written for them, so it is shown as-is; anything else
 * never reached the server, and saying so is more useful than a generic
 * failure.
 */
export function actionErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return 'Could not reach the server. Check your connection and try again.';
}
