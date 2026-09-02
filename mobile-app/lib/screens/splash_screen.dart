import 'dart:async';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/notification_preferences.dart';
import '../providers/notification_preferences_provider.dart';
import '../providers/token_tracking_provider.dart';
import '../repositories/app_version_repository.dart';
import '../repositories/device_repository.dart';
import '../repositories/token_repository.dart';
import '../services/fcm_service.dart';
import '../services/notification_service.dart';
import 'home_screen.dart';
import 'live_tracking_screen.dart';
import 'update_required_screen.dart';

/// Performs one-time startup work (local notification setup, best-effort
/// FCM init, device registration) before showing Home. None of this is
/// business logic a widget should own long-term — it just needs somewhere
/// to run once at launch.
///
/// Issue #5 additions:
///  - registers the FCM token with the backend (and keeps it registered
///    across rotation via onTokenRefresh) so token-status-change pushes
///    have somewhere to go — reuses the exact same "best-effort, never
///    blocks startup" treatment already given to device registration below.
///  - if the app was launched by tapping a token-status-change
///    notification (cold start), fetches that token and resumes tracking
///    directly on Live Tracking instead of Home — composed entirely from
///    existing pieces (TokenRepository.getToken, TokenTrackingProvider.start,
///    LiveTrackingScreen), no new navigation/deep-link system.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _bootstrap());
  }

  Future<void> _bootstrap() async {
    // V2 Checkpoint 9 (ADR-031): the version-compatibility gate runs first,
    // before any other startup work — a blocked install has no reason to
    // register FCM tokens, request notification permissions, or register a
    // device, and the rest of the app must not be reachable through normal
    // navigation if it's incompatible (pushReplacement below leaves nothing
    // to back-navigate into).
    final appVersionRepository = context.read<AppVersionRepository>();
    final compatibility = await appVersionRepository.checkCompatibility();
    if (!mounted) return;
    if (compatibility.updateRequired) {
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => UpdateRequiredScreen(compatibility: compatibility)),
      );
      return;
    }

    final notificationService = context.read<NotificationService>();
    final fcmService = context.read<FcmService>();
    final deviceRepository = context.read<DeviceRepository>();
    final preferencesProvider = context.read<NotificationPreferencesProvider>();
    final tokenRepository = context.read<TokenRepository>();
    final trackingProvider = context.read<TokenTrackingProvider>();

    // Subscribed BEFORE fcmService.initialize() runs — initialize() may
    // synchronously replay a cold-start getInitialMessage() into this same
    // broadcast stream during its own execution, and a broadcast stream
    // never replays to a listener that subscribes after the fact.
    RemoteMessage? pendingTap;
    final tapSub = fcmService.onNotificationTapped.listen((message) => pendingTap = message);

    await notificationService.initialize();
    // Best-effort: never blocks startup if unavailable (see FcmService doc).
    await fcmService.initialize();
    // So TokenConfirmationScreen/TokenTrackingProvider read real saved
    // preferences (not just in-memory defaults) once the customer joins.
    await preferencesProvider.load();
    // Best-effort: a failed registration here just means it retries the
    // next time the customer actually tries to join a queue.
    try {
      await deviceRepository.ensureRegisteredDevice();
    } catch (_) {
      // Ignored here deliberately — QueueJoinProvider.submitJoin() also
      // calls ensureRegisteredDevice() and will surface any real failure
      // to the user at the point where it actually matters.
    }

    // Issue #5: register the FCM token the same best-effort way — a failed
    // registration here just means this device won't receive push updates
    // until the next launch retries it; it must never block startup or the
    // rest of the app (REST, Socket.io) from working.
    final currentFcmToken = fcmService.fcmToken;
    if (currentFcmToken != null) {
      await _registerFcmTokenSafely(deviceRepository, currentFcmToken);
    }
    // Kept alive for the app's whole lifetime, same as FcmService/
    // DeviceRepository themselves (both app-root singletons, never
    // disposed) — a registration token can rotate at any point during the
    // session, not just at startup.
    fcmService.onTokenRefreshed.listen((newToken) {
      unawaited(_registerFcmTokenSafely(deviceRepository, newToken));
    });

    await tapSub.cancel();
    if (!mounted) return;

    final resumed = await _tryResumeFromTap(
      pendingTap,
      tokenRepository: tokenRepository,
      trackingProvider: trackingProvider,
      preferences: preferencesProvider.preferences,
    );
    if (!mounted || resumed) return;

    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const HomeScreen()),
    );
  }

  Future<void> _registerFcmTokenSafely(DeviceRepository deviceRepository, String fcmToken) async {
    try {
      await deviceRepository.registerFcmToken(fcmToken);
    } catch (_) {
      // Same reasoning as device registration above — never let a push-
      // token registration failure affect anything else.
    }
  }

  /// Returns true (and has already navigated) if [pendingTap] was a
  /// `token_status_changed` notification tap that resumed the app from a
  /// cold start — in that case we skip Home entirely and resume live
  /// tracking for that token directly, using its authoritative REST state
  /// (never the tapped notification's own payload).
  Future<bool> _tryResumeFromTap(
    RemoteMessage? pendingTap, {
    required TokenRepository tokenRepository,
    required TokenTrackingProvider trackingProvider,
    required NotificationPreferences preferences,
  }) async {
    if (pendingTap == null || pendingTap.data['type'] != 'token_status_changed') {
      return false;
    }
    final tokenId = pendingTap.data['tokenId'] as String?;
    if (tokenId == null) return false;

    try {
      final fetchedToken = await tokenRepository.getToken(tokenId);
      trackingProvider.start(fetchedToken, preferences);
      if (!mounted) return true;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => const LiveTrackingScreen()),
      );
      return true;
    } catch (_) {
      // Token no longer resolvable (e.g. stale id) — fall through to Home
      // rather than stranding the user on a broken deep link.
      return false;
    }
  }

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.groups_2_outlined, size: 72, color: Colors.indigo),
            SizedBox(height: 16),
            Text('LiveQueue', style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold)),
            SizedBox(height: 24),
            CircularProgressIndicator(),
          ],
        ),
      ),
    );
  }
}
