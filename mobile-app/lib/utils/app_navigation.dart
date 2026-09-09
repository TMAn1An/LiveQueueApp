import 'package:flutter/material.dart';

/// The one [Navigator] key for the whole app (V2 Physical Validation +
/// Foreground Notification checkpoint). Exists so code with no
/// [BuildContext] of its own — a global FCM listener, the foreground
/// banner service — can still reach the current screen's [Overlay] and
/// [Navigator] safely, rather than capturing a context at one point in time
/// and risking it being stale or disposed by the time it's used.
final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();
