import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import '../firebase_options.dart';
import 'notification_service.dart';

/// Runs in a separate background isolate spawned by the OS, so it must be a
/// top-level (or static) function — it cannot close over app/widget state.
/// That isolate has its own fresh Dart VM with no prior Firebase init, so
/// `Firebase.initializeApp` must be called again here; this is NOT the same
/// duplicate-init problem `initialize()` guards against below, since it's a
/// different isolate entirely (this is the pattern the official FlutterFire
/// docs require).
///
/// Deliberately minimal: Android/iOS already show the system notification
/// automatically for a `notification`-payload FCM message when the app is
/// backgrounded/terminated (that's default OS behavior, nothing in this app
/// makes it happen) — showing our own local notification here too would
/// double it up. This handler exists for future background *data* processing
/// once the backend defines a real payload contract (Phase 7 backend scope,
/// not yet implemented), not to display anything itself today.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  if (Firebase.apps.isEmpty) {
    await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  }
  if (kDebugMode) {
    debugPrint('FCM background message received: ${message.messageId}');
  }
}

/// Background push notification integration (spec: "Firebase Cloud
/// Messaging (FCM) for reliable background push notifications" — mobile
/// stack decision; IMPLEMENTATION_PLAN.md Phase 5 task "FCM setup for
/// background notifications"). Backed by a real Firebase project
/// (livequeue-99529) as of this pass — see docs/PROGRESS.md for the history
/// of this class before that existed.
///
/// [initialize] is fully guarded: any failure (network, permission denial,
/// misconfiguration) degrades to [isAvailable] == false rather than
/// throwing, so the rest of the app (REST, Socket.io, local notifications)
/// is never affected by an FCM problem — this class is additive, never a
/// dependency of anything else in the app.
class FcmService {
  FcmService({required NotificationService notificationService})
      : _notificationService = notificationService;

  final NotificationService _notificationService;

  bool _available = false;
  String? _fcmToken;
  final _tapController = StreamController<RemoteMessage>.broadcast();

  bool get isAvailable => _available;
  String? get fcmToken => _fcmToken;

  /// Fires when the user taps a notification that opened/resumed the app —
  /// from background (`onMessageOpenedApp`) or from fully terminated
  /// (`getInitialMessage`, replayed once here so both cases look the same
  /// to a listener). No screen subscribes to this yet: the backend has no
  /// FCM payload contract to route on (Phase 7 backend scope), so this is
  /// the hook a future screen would use, not a finished feature.
  Stream<RemoteMessage> get onNotificationTapped => _tapController.stream;

  Future<void> initialize() async {
    try {
      // main() already does this; this only matters if that earlier attempt
      // failed (or hasn't run for some reason) — never re-initialize an
      // already-initialized default app, which throws duplicate-app.
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
      }

      final messaging = FirebaseMessaging.instance;
      final settings = await messaging.requestPermission(alert: true, badge: true, sound: true);

      if (settings.authorizationStatus == AuthorizationStatus.denied) {
        _available = false;
        return;
      }

      _fcmToken = await messaging.getToken();
      _available = _fcmToken != null;

      // Debug-only, redacted: confirms a token exists without ever logging
      // the full credential, and never runs in a release build.
      if (kDebugMode) {
        final token = _fcmToken;
        debugPrint(
          token != null
              ? 'FCM token obtained: ${token.substring(0, 12)}… (${token.length} chars total)'
              : 'FCM getToken() returned null.',
        );
      }

      FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);

      // Foreground: the OS does NOT show a system notification while the
      // app is active, so this is the one case that must display one itself
      // — reuses NotificationService rather than a second notification path.
      FirebaseMessaging.onMessage.listen((RemoteMessage message) {
        final title = message.notification?.title;
        final body = message.notification?.body;
        if (title != null && body != null) {
          unawaited(_notificationService.showGenericNotification(title: title, body: body));
        }
        if (kDebugMode) {
          debugPrint('FCM foreground message received: ${message.messageId}');
        }
      });

      FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
        if (kDebugMode) {
          debugPrint('FCM notification tapped (onMessageOpenedApp): ${message.messageId}');
        }
        _tapController.add(message);
      });

      final initialMessage = await messaging.getInitialMessage();
      if (initialMessage != null) {
        if (kDebugMode) {
          debugPrint('FCM app launched by tapping notification (getInitialMessage): ${initialMessage.messageId}');
        }
        _tapController.add(initialMessage);
      }
    } catch (err) {
      // No Firebase project configured, or FCM otherwise unavailable —
      // degrade gracefully rather than crash the app.
      _available = false;
      if (kDebugMode) {
        debugPrint('FCM unavailable: $err');
      }
    }
  }

  void dispose() {
    unawaited(_tapController.close());
  }
}
