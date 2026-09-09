import 'dart:async';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/notification_preferences.dart';
import '../providers/active_token_provider.dart';
import '../providers/notification_preferences_provider.dart';
import '../providers/token_tracking_provider.dart';
import '../repositories/app_version_repository.dart';
import '../repositories/device_repository.dart';
import '../repositories/token_repository.dart';
import '../services/fcm_service.dart';
import '../services/notification_service.dart';
import '../utils/cross_token_fcm_resync.dart';
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

  /// Startup is split in two: the work that must finish before the customer
  /// may use the app, and the work that only has to happen eventually.
  ///
  /// Everything below used to be awaited in sequence before Home appeared,
  /// which meant a customer could watch this screen for a minute or more:
  /// `FirebaseMessaging.getToken()` is a network round-trip with no timeout
  /// of its own, device registration and FCM-token registration are two
  /// more requests, and on a cold backend each of those spends its full
  /// timeout before failing. None of it is needed to show Home — Home only
  /// offers "scan a QR code", "history" and "settings" — so only the
  /// version gate and local preferences block now, and the rest continues
  /// behind the already-visible UI.
  Future<void> _bootstrap() async {
    final startedAt = DateTime.now();

    // V2 Checkpoint 9 (ADR-031): the version-compatibility gate still runs
    // first and still blocks. It is a safety gate, not an optimisation:
    // a blocked install must never reach the rest of the app. Its own
    // request carries a short timeout and falls back to the cached policy,
    // so a sleeping backend delays startup by seconds, not minutes.
    final appVersionRepository = context.read<AppVersionRepository>();
    final compatibility = await appVersionRepository.checkCompatibility();
    _logPhase('version policy', startedAt);
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
    final activeTokenProvider = context.read<ActiveTokenProvider>();
    // Captured while this widget is still mounted: the background work below
    // outlives this screen, so it can never touch `context` again.
    final navigator = Navigator.of(context);

    // Subscribed BEFORE fcmService.initialize() runs — initialize() may
    // synchronously replay a cold-start getInitialMessage() into this same
    // broadcast stream during its own execution, and a broadcast stream
    // never replays to a listener that subscribes after the fact.
    RemoteMessage? pendingTap;
    final tapSub = fcmService.onNotificationTapped.listen((message) => pendingTap = message);

    // Local storage only — no network, so this stays on the blocking path:
    // TokenConfirmationScreen and TokenTrackingProvider must read the
    // customer's real saved preferences, not in-memory defaults.
    await preferencesProvider.load();
    _logPhase('preferences', startedAt);
    if (!mounted) return;

    navigator.pushReplacement(MaterialPageRoute(builder: (_) => const HomeScreen()));
    _logPhase('home visible', startedAt);

    unawaited(
      _initializeInBackground(
        startedAt: startedAt,
        navigator: navigator,
        notificationService: notificationService,
        fcmService: fcmService,
        deviceRepository: deviceRepository,
        tokenRepository: tokenRepository,
        trackingProvider: trackingProvider,
        activeTokenProvider: activeTokenProvider,
        preferencesProvider: preferencesProvider,
        tapSub: tapSub,
        readPendingTap: () => pendingTap,
      ),
    );
  }

  /// Runs after Home is already on screen. Every step here was previously
  /// awaited ahead of it; none of them gate anything Home itself can do, and
  /// each already degrades safely on failure.
  Future<void> _initializeInBackground({
    required DateTime startedAt,
    required NavigatorState navigator,
    required NotificationService notificationService,
    required FcmService fcmService,
    required DeviceRepository deviceRepository,
    required TokenRepository tokenRepository,
    required TokenTrackingProvider trackingProvider,
    required ActiveTokenProvider activeTokenProvider,
    required NotificationPreferencesProvider preferencesProvider,
    required StreamSubscription<RemoteMessage> tapSub,
    required RemoteMessage? Function() readPendingTap,
  }) async {
    await notificationService.initialize();
    _logPhase('notifications', startedAt);

    // Best-effort: never blocks anything if unavailable (see FcmService
    // doc). getToken() in particular is an unbounded network call, which is
    // exactly why it no longer sits in front of Home.
    await fcmService.initialize();
    _logPhase('fcm', startedAt);

    // Best-effort: a failed registration here just means it retries the
    // next time the customer actually tries to join a queue.
    try {
      await deviceRepository.ensureRegisteredDevice();
    } catch (_) {
      // Ignored here deliberately — QueueJoinProvider.submitJoin() also
      // calls ensureRegisteredDevice() and will surface any real failure
      // to the user at the point where it actually matters.
    }
    _logPhase('device registration', startedAt);

    // Issue #5: register the FCM token the same best-effort way — a failed
    // registration here just means this device won't receive push updates
    // until the next launch retries it.
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

    // V2 Physical Validation + Foreground Notification checkpoint, Part J:
    // closes the cross-token gap without a permanent per-token Socket.io
    // subscription. TokenTrackingProvider already has its own FCM listener,
    // but it only ever acts on the one token it is currently tracking — a
    // status change on any *other* remembered token previously went
    // unnoticed by the app until its next incidental resync (Home/Active
    // Tokens reopening). This listener is kept alive for the app's whole
    // lifetime, same as the token-refresh one above, and does the smallest
    // thing that closes it: on a foreground push naming a token that is (a)
    // one this installation actually remembers and (b) not the one already
    // being live-tracked (which has a faster path via its own socket
    // session), resync just that one token — never every remembered one.
    // ActiveTokenProvider.resyncOne already records the Notification Center
    // entry and raises the foreground banner on a genuine status change
    // (see main.dart's onTokenStatusChanged/onNotificationAdded wiring), so
    // there is nothing else to wire here.
    fcmService.onDataMessage.listen((data) {
      final tokenId = tokenIdToResyncFor(
        data: data,
        currentlyTrackedTokenId: trackingProvider.token?.id,
        isRemembered: (id) => activeTokenProvider.summaryFor(id) != null,
      );
      if (tokenId != null) {
        unawaited(activeTokenProvider.resyncOne(tokenId));
      }
    });

    await tapSub.cancel();

    // A cold start from a tapped notification still resumes live tracking.
    // It now opens on top of Home rather than replacing the splash, since
    // Home is already showing by the time FCM finishes initializing — which
    // also leaves the customer somewhere sensible to go back to.
    await _tryResumeFromTap(
      readPendingTap(),
      navigator: navigator,
      tokenRepository: tokenRepository,
      trackingProvider: trackingProvider,
      preferences: preferencesProvider.preferences,
    );
    _logPhase('background init complete', startedAt);
  }

  /// Debug builds only — startup phase timings, so a regression here can be
  /// measured instead of guessed at. Never compiled into a release build,
  /// and carries no identifiers of any kind.
  void _logPhase(String phase, DateTime startedAt) {
    if (kDebugMode) {
      debugPrint('[startup] $phase: ${DateTime.now().difference(startedAt).inMilliseconds}ms');
    }
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
    required NavigatorState navigator,
    required TokenRepository tokenRepository,
    required TokenTrackingProvider trackingProvider,
    required NotificationPreferences preferences,
  }) async {
    // 'token_eta_updated' resumes tracking for exactly the same reason a
    // status change does: the customer tapped a notification about a token
    // they are still waiting on, and expects to land on it.
    const resumableTypes = {'token_status_changed', 'token_eta_updated'};
    if (pendingTap == null || !resumableTypes.contains(pendingTap.data['type'])) {
      return false;
    }
    final tokenId = pendingTap.data['tokenId'] as String?;
    if (tokenId == null) return false;

    try {
      final fetchedToken = await tokenRepository.getToken(tokenId);
      trackingProvider.start(fetchedToken, preferences);
      // Pushed on top of Home (which is already showing by now) rather than
      // replacing it — so closing live tracking returns somewhere useful.
      navigator.push(
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
    return Scaffold(
      backgroundColor: Colors.white,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // The full lockup (symbol, wordmark and tagline) — this is the
            // one screen with enough width to show it legibly.
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 32),
              child: Image.asset(
                'assets/images/livequeue-logo-full.png',
                width: 320,
                fit: BoxFit.contain,
                semanticLabel: 'LiveQueue',
              ),
            ),
            const SizedBox(height: 32),
            const CircularProgressIndicator(),
          ],
        ),
      ),
    );
  }
}
