import 'package:flutter/material.dart';

/// A small, non-blocking "🔔 A002 has been called" banner that can appear
/// over whatever screen the customer is currently on — Home, the scanner,
/// History, Settings, Live Tracking for a *different* token — without that
/// screen needing to know banners exist (V2 Physical Validation + Foreground
/// Notification checkpoint, Part F).
///
/// Deliberately not a SnackBar: a SnackBar is scoped to the nearest
/// [ScaffoldMessenger], so a banner about Token B would only ever reach
/// whichever screen happened to trigger it, not whatever screen the
/// customer is actually looking at. This inserts directly into the root
/// [Navigator]'s own [Overlay] instead — the one presentation surface that
/// sits above every screen in the app, reached by id via [navigatorKey]
/// rather than a [BuildContext] captured at some other point in time, so it
/// can never hold a stale or already-disposed context.
///
/// Not an [AlertDialog]: this must never block the current screen or demand
/// a response — the customer can keep using whatever they were doing
/// underneath it.
///
/// Persistent, not auto-dismissing (V2 UX + Token Lifecycle checkpoint,
/// Part A #2): a customer who glances away for a few seconds must not have
/// missed it. It stays up until explicitly dismissed (the × or a tap). A
/// second event arriving while one is already showing is queued rather than
/// silently dropped or overwritten — every genuinely new event still gets
/// its own banner, just never more than one visible at once (no stacking).
class ForegroundBannerService {
  ForegroundBannerService(this._navigatorKey);

  final GlobalKey<NavigatorState> _navigatorKey;

  OverlayEntry? _current;
  final List<_QueuedBanner> _queue = [];

  /// Shows a banner, or queues it behind whatever is currently shown.
  /// Silently does nothing (not even queueing) if the app has no attached
  /// [Overlay] yet (e.g. called before the first frame) — a missed banner
  /// costs nothing, since the event is already durably recorded in the
  /// Notification Center regardless.
  void show({required String title, required String body, required VoidCallback onTap}) {
    if (_navigatorKey.currentState?.overlay == null) return;

    if (_current != null) {
      _queue.add(_QueuedBanner(title: title, body: body, onTap: onTap));
      return;
    }
    _showNow(title: title, body: body, onTap: onTap);
  }

  void _showNow({required String title, required String body, required VoidCallback onTap}) {
    final overlay = _navigatorKey.currentState?.overlay;
    if (overlay == null) return;

    final entry = OverlayEntry(
      builder: (context) => _ForegroundBanner(
        title: title,
        body: body,
        onTap: () {
          dismiss();
          onTap();
        },
        onDismiss: dismiss,
      ),
    );
    _current = entry;
    overlay.insert(entry);
  }

  /// Dismisses whatever is currently shown and, if another event arrived in
  /// the meantime, immediately shows it next.
  void dismiss() {
    _current?.remove();
    _current = null;

    if (_queue.isNotEmpty) {
      final next = _queue.removeAt(0);
      _showNow(title: next.title, body: next.body, onTap: next.onTap);
    }
  }

  void dispose() {
    _queue.clear();
    _current?.remove();
    _current = null;
  }
}

class _QueuedBanner {
  const _QueuedBanner({required this.title, required this.body, required this.onTap});
  final String title;
  final String body;
  final VoidCallback onTap;
}

class _ForegroundBanner extends StatelessWidget {
  const _ForegroundBanner({
    required this.title,
    required this.body,
    required this.onTap,
    required this.onDismiss,
  });

  final String title;
  final String body;
  final VoidCallback onTap;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Positioned(
      top: 0,
      left: 0,
      right: 0,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Material(
            elevation: 6,
            borderRadius: BorderRadius.circular(12),
            color: theme.colorScheme.surface,
            child: InkWell(
              borderRadius: BorderRadius.circular(12),
              onTap: onTap,
              child: Semantics(
                // A single readable sentence, not two disjoint text nodes —
                // matters for a screen reader announcing this over whatever
                // screen is currently focused.
                label: '$title. $body',
                button: true,
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Row(
                    children: [
                      Icon(Icons.notifications_active, color: theme.colorScheme.primary),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              title,
                              style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold),
                            ),
                            Text(body, style: theme.textTheme.bodySmall),
                          ],
                        ),
                      ),
                      TextButton(onPressed: onTap, child: const Text('View')),
                      IconButton(
                        icon: const Icon(Icons.close, size: 18),
                        tooltip: 'Dismiss',
                        onPressed: onDismiss,
                      ),
                    ],
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
