/**
 * Tells other open tabs of this dashboard that the signed-in account's email
 * was just verified, so the tab still showing "Verify your email address" can
 * update itself instead of waiting for a manual reload. The verification link
 * is opened from the inbox, which is almost always a different tab.
 *
 * Carries no data — only "something changed, re-check". Every listener asks
 * the backend (/api/auth/me) for the real status, so a forged message can at
 * most cause one harmless extra request.
 */
const CHANNEL_NAME = 'livequeue:email-verified';

function openChannel(): BroadcastChannel | null {
  return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME);
}

export function announceEmailVerified(): void {
  const channel = openChannel();
  if (!channel) return;
  channel.postMessage('verified');
  channel.close();
}

/** Returns an unsubscribe function. */
export function onEmailVerifiedElsewhere(listener: () => void): () => void {
  const channel = openChannel();
  if (!channel) return () => {};
  channel.onmessage = () => listener();
  return () => channel.close();
}
