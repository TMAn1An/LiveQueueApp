import 'dart:async';

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
/// a response — it auto-dismisses, and the customer can keep using
/// whatever they were doing underneath it.
class ForegroundBannerService {
  ForegroundBannerService(this._navigatorKey);

  final GlobalKey<NavigatorState> _navigatorKey;

  OverlayEntry? _current;
  Timer? _dismissTimer;

  static const _visibleFor = Duration(seconds: 5);

  /// Shows a banner, replacing whatever is currently shown. Silently does
  /// nothing if the app has no attached [Overlay] yet (e.g. called before
  /// the first frame) — a missed banner costs nothing, since the event is
  /// already durably recorded in the Notification Center regardless.
  void show({required String title, required String body, required VoidCallback onTap}) {
    dismiss();

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
    _dismissTimer = Timer(_visibleFor, dismiss);
  }

  void dismiss() {
    _dismissTimer?.cancel();
    _dismissTimer = null;
    _current?.remove();
    _current = null;
  }

  void dispose() => dismiss();
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
