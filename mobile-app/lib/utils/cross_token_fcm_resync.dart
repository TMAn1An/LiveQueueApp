/// Decides whether a foreground FCM data message should trigger a targeted
/// resync of some *other* remembered token (V2 Physical Validation +
/// Foreground Notification checkpoint, Part J).
///
/// Kept as a small pure function, next to [SplashScreen]'s listener rather
/// than inline in it, for two reasons: it can be tested without needing
/// SplashScreen's platform-channel-heavy bootstrap (Firebase, local
/// notifications), and "what counts as worth resyncing" is easier to read
/// as one guarded return sequence than as nested conditionals inside a
/// stream listener.
///
/// Returns the token id to resync, or `null` if this event should be
/// ignored entirely:
///  - not the event type this policy understands (e.g. `token_eta_updated`,
///    which the actively-tracked token's own listener already handles);
///  - a malformed or missing `tokenId` — never assumed to be a String;
///  - the token already being live-tracked, which has a faster path via
///    its own Socket.io session and its own FCM listener, so resyncing it
///    again here would just be a redundant second request for one event;
///  - a token id this installation does not actually remember, which is
///    either a stale/unrelated push or a customer who cleared their local
///    state — either way, not something to act on.
String? tokenIdToResyncFor({
  required Map<String, dynamic> data,
  required String? currentlyTrackedTokenId,
  required bool Function(String tokenId) isRemembered,
}) {
  if (data['type'] != 'token_status_changed') return null;

  final tokenId = data['tokenId'];
  if (tokenId is! String || tokenId.isEmpty) return null;

  if (tokenId == currentlyTrackedTokenId) return null;
  if (!isRemembered(tokenId)) return null;

  return tokenId;
}
