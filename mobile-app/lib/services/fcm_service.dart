import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

/// Background push notification scaffolding (spec: "Firebase Cloud
/// Messaging (FCM) for reliable background push notifications" — mobile
/// stack decision; IMPLEMENTATION_PLAN.md Phase 5 task "FCM setup for
/// background notifications").
///
/// KNOWN LIMITATION (see docs/PROGRESS.md): this cannot deliver real
/// background push in this environment. Two things are missing that this
/// session cannot supply:
///   1. A real Firebase project + generated config (`firebase_options.dart`,
///      `google-services.json` / `GoogleService-Info.plist`) —
///      IMPLEMENTATION_PLAN.md's own "Open Questions" flags this exact gap
///      ("Firebase project must be created before Phase 5. Who creates it?").
///   2. A backend endpoint to store each device's FCM token and a
///      server-side dispatch job to actually send pushes — that's
///      IMPLEMENTATION_PLAN.md Phase 7 ("Push notification jobs", "node-cron
///      for scheduled reminder dispatch"), not Phase 5.
///
/// [initialize] is therefore fully guarded: without Firebase configured, it
/// fails fast and silently, and the rest of the app (REST, Socket.io live
/// tracking, local notifications) is completely unaffected — this class is
/// forward-compatible scaffolding, not a functioning push pipeline yet.
class FcmService {
  bool _available = false;
  String? _fcmToken;

  bool get isAvailable => _available;
  String? get fcmToken => _fcmToken;

  Future<void> initialize() async {
    try {
      await Firebase.initializeApp();
      final messaging = FirebaseMessaging.instance;
      final settings = await messaging.requestPermission(alert: true, badge: true, sound: true);

      if (settings.authorizationStatus == AuthorizationStatus.denied) {
        _available = false;
        return;
      }

      _fcmToken = await messaging.getToken();
      _available = _fcmToken != null;

      FirebaseMessaging.onMessage.listen((RemoteMessage message) {
        // Foreground messages: in a fully wired setup, this would surface a
        // local notification via NotificationService. No backend endpoint
        // sends these yet (see class doc), so this is a no-op today.
        if (kDebugMode) {
          debugPrint('FCM foreground message received: ${message.messageId}');
        }
      });
    } catch (err) {
      // No Firebase project configured in this repository — expected in
      // this environment. Degrade gracefully rather than crash the app.
      _available = false;
      if (kDebugMode) {
        debugPrint('FCM unavailable (no Firebase project configured): $err');
      }
    }
  }
}
