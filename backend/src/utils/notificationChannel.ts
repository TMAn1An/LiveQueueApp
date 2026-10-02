/**
 * Which Android notification channel a push should be shown on (ADR-062).
 *
 * Since Android 8 a notification's sound and vibration belong to its channel,
 * not to the notification — so "sound off" can only be honoured by posting to
 * a channel that was created silent. The app creates one channel per
 * sound/vibration combination under these exact ids
 * (mobile-app/lib/services/notification_service.dart); a push the system
 * displays while the app is closed has to name the right one itself, because
 * no app code runs to choose it.
 *
 * The ids are a contract with the app. If the named channel does not exist on
 * the device (an older app version), Android falls back to its default
 * channel and the notification is still shown.
 */
export type NotificationChannelKind = 'turn_alert' | 'queue_updates';

export interface AlertPreference {
  soundEnabled: boolean;
  vibrationEnabled: boolean;
}

export function androidChannelId(kind: NotificationChannelKind, preference: AlertPreference): string {
  if (preference.soundEnabled && preference.vibrationEnabled) return kind;
  if (preference.soundEnabled) return `${kind}_sound_only`;
  if (preference.vibrationEnabled) return `${kind}_vibrate_only`;
  return `${kind}_silent`;
}
