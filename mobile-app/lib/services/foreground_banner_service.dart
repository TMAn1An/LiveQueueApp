import 'package:flutter/material.dart';

import '../models/live_queue_token.dart';

/// A prominent, centered notification card that can appear over whatever
/// screen the customer is currently on — Home, the scanner, History,
/// Settings, Live Tracking for a *different* token — without that screen
/// needing to know cards exist (V2 Physical Validation + Foreground
/// Notification checkpoint, Part F; redesigned from a top banner to a
/// centered card in the Centered Foreground Notification phase — see
/// ADR-044).
///
/// Deliberately not a SnackBar: a SnackBar is scoped to the nearest
/// [ScaffoldMessenger], so a card about Token B would only ever reach
/// whichever screen happened to trigger it, not whatever screen the
/// customer is actually looking at. This inserts directly into the root
/// [Navigator]'s own [Overlay] instead — the one presentation surface that
/// sits above every screen in the app, reached by id via [navigatorKey]
/// rather than a [BuildContext] captured at some other point in time, so it
/// can never hold a stale or already-disposed context.
///
/// Not an [AlertDialog] / [showDialog]: this must never block the current
/// screen with a true modal barrier or demand a response — the customer can
/// keep using whatever they were doing underneath it. The dimmed backdrop is
/// purely visual emphasis; it intercepts taps only so a tap "through" the
/// card can't accidentally trigger whatever sits beneath it, never to
/// dismiss the card itself.
///
/// Persistent, not auto-dismissing (V2 UX + Token Lifecycle checkpoint,
/// Part A #2): a customer who glances away for a few seconds must not have
/// missed it. It stays up until explicitly dismissed (the × or View). A
/// second event arriving while one is already showing is queued rather than
/// silently dropped or overwritten — every genuinely new event still gets
/// its own card, just never more than one visible at once (no stacking).
///
/// Deduplication of the *same* logical event is primarily
/// NotificationCenterProvider's job (it never calls back twice for one
/// event id — see `_upsert`), so in ordinary operation this service never
/// even receives a duplicate. [show]'s optional [dedupeKey] is a second,
/// independent guard at this layer: if it matches whatever is currently
/// showing or already queued, the new call is dropped rather than adding a
/// second visible-or-queued card for the same event.
class ForegroundBannerService {
  ForegroundBannerService(this._navigatorKey);

  final GlobalKey<NavigatorState> _navigatorKey;

  OverlayEntry? _current;
  String? _currentDedupeKey;
  final List<_QueuedCard> _queue = [];

  /// Shows a card, or queues it behind whatever is currently shown. Silently
  /// does nothing (not even queueing) if the app has no attached [Overlay]
  /// yet (e.g. called before the first frame) — a missed card costs nothing,
  /// since the event is already durably recorded in the Notification Center
  /// regardless.
  void show({
    required String title,
    required String body,
    required VoidCallback onTap,
    TokenStatus? status,
    String? dedupeKey,
  }) {
    if (_navigatorKey.currentState?.overlay == null) return;

    if (dedupeKey != null &&
        (dedupeKey == _currentDedupeKey || _queue.any((q) => q.dedupeKey == dedupeKey))) {
      return;
    }

    if (_current != null) {
      _queue.add(_QueuedCard(title: title, body: body, onTap: onTap, status: status, dedupeKey: dedupeKey));
      return;
    }
    _showNow(title: title, body: body, onTap: onTap, status: status, dedupeKey: dedupeKey);
  }

  void _showNow({
    required String title,
    required String body,
    required VoidCallback onTap,
    TokenStatus? status,
    String? dedupeKey,
  }) {
    final overlay = _navigatorKey.currentState?.overlay;
    if (overlay == null) return;

    final entry = OverlayEntry(
      builder: (context) => _ForegroundNotificationCard(
        title: title,
        body: body,
        icon: _iconFor(status),
        onTap: () {
          dismiss();
          onTap();
        },
        onDismiss: dismiss,
      ),
    );
    _current = entry;
    _currentDedupeKey = dedupeKey;
    overlay.insert(entry);
  }

  /// Dismisses whatever is currently shown and, if another event arrived in
  /// the meantime, immediately shows it next.
  void dismiss() {
    _current?.remove();
    _current = null;
    _currentDedupeKey = null;

    if (_queue.isNotEmpty) {
      final next = _queue.removeAt(0);
      _showNow(title: next.title, body: next.body, onTap: next.onTap, status: next.status, dedupeKey: next.dedupeKey);
    }
  }

  void dispose() {
    _queue.clear();
    _current?.remove();
    _current = null;
    _currentDedupeKey = null;
  }

  IconData _iconFor(TokenStatus? status) {
    return switch (status) {
      TokenStatus.called => Icons.record_voice_over,
      TokenStatus.inProgress => Icons.play_circle,
      TokenStatus.completed => Icons.check_circle,
      TokenStatus.skipped => Icons.report_gmailerrorred,
      TokenStatus.cancelled => Icons.cancel,
      TokenStatus.waiting || TokenStatus.unknown || null => Icons.notifications_active,
    };
  }
}

class _QueuedCard {
  const _QueuedCard({
    required this.title,
    required this.body,
    required this.onTap,
    this.status,
    this.dedupeKey,
  });
  final String title;
  final String body;
  final VoidCallback onTap;
  final TokenStatus? status;
  final String? dedupeKey;
}

class _ForegroundNotificationCard extends StatelessWidget {
  const _ForegroundNotificationCard({
    required this.title,
    required this.body,
    required this.icon,
    required this.onTap,
    required this.onDismiss,
  });

  final String title;
  final String body;
  final IconData icon;
  final VoidCallback onTap;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Positioned.fill(
      child: Container(
        // Subtle dimming only — this absorbs a stray tap so it can't reach
        // whatever screen sits underneath, but never dismisses the card
        // itself; dismissal is explicit (× or View) only.
        color: Colors.black.withValues(alpha: 0.35),
        alignment: Alignment.center,
        child: GestureDetector(
          // Swallow taps on the backdrop rather than letting them fall
          // through to the screen beneath — still not a dismissal.
          onTap: () {},
          child: SafeArea(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 320),
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Material(
                  elevation: 12,
                  borderRadius: BorderRadius.circular(20),
                  color: theme.colorScheme.surface,
                  child: GestureDetector(
                    // Absorb taps on the card body that land outside the
                    // View/close controls so they never fall through either.
                    onTap: () {},
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(20, 12, 12, 20),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.end,
                            children: [
                              Semantics(
                                label: 'Dismiss notification',
                                button: true,
                                excludeSemantics: true,
                                child: IconButton(
                                  icon: const Icon(Icons.close, size: 20),
                                  tooltip: 'Dismiss',
                                  onPressed: onDismiss,
                                ),
                              ),
                            ],
                          ),
                          Icon(icon, size: 40, color: theme.colorScheme.primary),
                          const SizedBox(height: 12),
                          Text(
                            title,
                            textAlign: TextAlign.center,
                            style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
                          ),
                          const SizedBox(height: 8),
                          // ADR-042: a body can now carry staff feedback of up
                          // to 500 characters; the card stays compact and the
                          // full text is one tap (View) away.
                          Text(
                            body,
                            textAlign: TextAlign.center,
                            style: theme.textTheme.bodyMedium,
                            maxLines: 4,
                            overflow: TextOverflow.ellipsis,
                          ),
                          const SizedBox(height: 20),
                          Semantics(
                            label: 'View details for $title',
                            button: true,
                            excludeSemantics: true,
                            child: FilledButton(
                              onPressed: onTap,
                              child: const Text('View'),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
