/**
 * How long before a customer's turn their reminder goes out (spec 7.18).
 *
 * Two parties can have an opinion: the queue ("default reminder time", set
 * on the dashboard) and the customer (their own choice in the app). The
 * customer's choice always wins; the queue's default applies only when the
 * customer has not made one (ADR-062).
 */

/** Spec 7.18: "Minimum: 2 minutes". */
export const MIN_REMINDER_MINUTES = 2;
/** A reminder further ahead than this says nothing a customer can act on. */
export const MAX_REMINDER_MINUTES = 120;

/** A queue's default as it can actually be used. Queues created before the
 * range was enforced may hold a value outside it. */
export function queueDefaultReminderMinutes(defaultNotificationMinutes: number): number {
  return Math.min(MAX_REMINDER_MINUTES, Math.max(MIN_REMINDER_MINUTES, defaultNotificationMinutes));
}

/** The reminder time in force for one token. `customMinutes` is the
 * customer's own choice, or null when they left it to the queue. */
export function effectiveReminderMinutes(
  customMinutes: number | null,
  defaultNotificationMinutes: number,
): number {
  return customMinutes ?? queueDefaultReminderMinutes(defaultNotificationMinutes);
}
