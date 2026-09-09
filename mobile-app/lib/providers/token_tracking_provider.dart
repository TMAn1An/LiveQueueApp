import 'dart:async';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import '../models/eta_update_notice.dart';
import '../models/live_queue_token.dart';
import '../models/notification_preferences.dart';
import '../repositories/device_repository.dart';
import '../repositories/history_repository.dart';
import '../repositories/token_repository.dart';
import '../services/fcm_service.dart';
import '../services/notification_service.dart';

/// Live-tracks a single token via Socket.io, with REST as the fallback
/// source of truth (spec section 26: "refresh token status after
/// reconnecting" — every reconnect triggers a REST resync here, never
/// relying on missed events being replayed, matching Phase 4's own "no
/// event replay" design).
///
/// Issue #5: FCM is a second, independent trigger for that same REST
/// resync — a `token_status_changed` data message (received in foreground,
/// or carried by a tapped notification that resumed the app) never sets
/// `token.status` directly from the payload. It only ever asks
/// [_resyncFromServer] to fetch authoritative state, exactly like a socket
/// reconnect does — so a delayed, duplicated, or out-of-order FCM message
/// can never leave this provider showing anything other than the backend's
/// current truth.
class TokenTrackingProvider extends ChangeNotifier {
  TokenTrackingProvider({
    required TokenRepository tokenRepository,
    required DeviceRepository deviceRepository,
    required HistoryRepository historyRepository,
    required NotificationService notificationService,
    required FcmService fcmService,
  })  : _tokenRepository = tokenRepository,
        _deviceRepository = deviceRepository,
        _historyRepository = historyRepository,
        _notificationService = notificationService,
        _fcmService = fcmService;

  final TokenRepository _tokenRepository;
  final DeviceRepository _deviceRepository;
  final HistoryRepository _historyRepository;
  final NotificationService _notificationService;
  final FcmService _fcmService;

  LiveQueueToken? token;
  bool isConnected = false;
  bool isResyncing = false;
  String? errorMessage;
  bool queuePausedNotice = false;

  /// V2 Checkpoint 7 (ADR-029) — the customer's own service-start
  /// verification code, fetched only while the tracked token is CALLED.
  /// Never sourced from Socket.io/FCM (the backend never puts it there);
  /// always a direct, ownership-checked REST read/reissue.
  String? verificationCode;
  DateTime? verificationCodeExpiresAt;
  bool isLoadingVerificationCode = false;
  bool isCancelling = false;

  /// Set when staff explicitly changed how long a service is expected to
  /// take and that changed this customer's ETA — the one-shot signal the
  /// Live Tracking screen turns into a dismissible notice. Null means
  /// "nothing to announce", which is also the state after [dismissEtaUpdateNotice].
  ///
  /// Only ever the newest value: a burst of recalculations collapses into a
  /// single notice showing the latest time, rather than a queue of stale
  /// popups the customer has to dismiss one by one.
  EtaUpdateNotice? etaUpdateNotice;

  NotificationPreferences _preferences = const NotificationPreferences();
  bool _reminderShown = false;

  /// Display context only, for the Notification Center entries this session
  /// records — never sent anywhere, never part of any request.
  String _queueName = '';

  StreamSubscription<bool>? _connectionSub;
  StreamSubscription<LiveQueueToken>? _lifecycleSub;
  StreamSubscription<PositionUpdate>? _positionSub;
  StreamSubscription<QueueStatusUpdate>? _queueStatusSub;
  StreamSubscription<Map<String, dynamic>>? _fcmDataSub;
  StreamSubscription<RemoteMessage>? _fcmTapSub;

  void start(
    LiveQueueToken initialToken,
    NotificationPreferences preferences, {
    String queueName = '',
  }) {
    token = initialToken;
    _preferences = preferences;
    _reminderShown = false;
    _queueName = queueName;

    _tokenRepository.connectSocket();
    _tokenRepository.joinTokenRoom(initialToken.id);
    _tokenRepository.joinQueueRoom(initialToken.queueId);

    _connectionSub = _tokenRepository.connectionStatus.listen(_onConnectionChanged);
    _lifecycleSub = _tokenRepository.tokenLifecycleUpdates.listen(_onLifecycleUpdate);
    _positionSub = _tokenRepository.positionUpdates.listen(_onPositionUpdate);
    _queueStatusSub = _tokenRepository.queueStatusUpdates.listen(_onQueueStatusUpdate);
    // Foreground data message (Issue #5) — the fast path when the app is
    // open but this specific screen's socket update is delayed or missed.
    _fcmDataSub = _fcmService.onDataMessage.listen(_onFcmDataMessage);
    // A tapped notification that resumed an already-running app (not a
    // cold start — that path is SplashScreen's job) carries the same data
    // shape, so it's handled identically: resync if it's about the token
    // we're already tracking.
    _fcmTapSub = _fcmService.onNotificationTapped.listen((message) => _onFcmDataMessage(message.data));

    if (initialToken.status == TokenStatus.called) {
      unawaited(_refreshVerificationCode());
    }
  }

  /// Never trusts `data['status']` as authoritative — always resyncs via
  /// REST instead (approved Issue #5 design: FCM is a trigger, not a state
  /// source). Ignored if it isn't about the token currently being tracked,
  /// or isn't the event type this provider knows how to react to.
  Future<void> _onFcmDataMessage(Map<String, dynamic> data) async {
    // 'token_eta_updated' is the push sent when staff change a service time
    // while the app is backgrounded. It resyncs exactly like a status
    // change and deliberately does NOT raise the in-app notice: while the
    // app is open the socket already delivers that, and showing both would
    // be two alerts for one update.
    const handled = {'token_status_changed', 'token_eta_updated'};
    if (!handled.contains(data['type'])) return;
    final current = token;
    if (current == null || data['tokenId'] != current.id) return;
    await _resyncFromServer();
  }

  void updatePreferences(NotificationPreferences preferences) {
    _preferences = preferences;
  }

  Future<void> _onConnectionChanged(bool connected) async {
    isConnected = connected;
    notifyListeners();

    if (connected) {
      // Every (re)connect resyncs from the server — covers both the initial
      // connect (harmless no-op refresh) and any real reconnect after a
      // drop, without needing to distinguish the two.
      await _resyncFromServer();
    }
  }

  Future<void> _resyncFromServer() async {
    final current = token;
    if (current == null) return;

    isResyncing = true;
    notifyListeners();
    try {
      final fresh = await _tokenRepository.getToken(current.id);
      _applyToken(fresh);
    } catch (_) {
      // Keep the last known state rather than clearing it — spec section
      // 26: "keep the last known token status... do not show stale
      // information as current" is handled by the isConnected/isResyncing
      // flags the UI reads alongside `token`, not by discarding the token.
    } finally {
      isResyncing = false;
      notifyListeners();
    }
  }

  void _onLifecycleUpdate(LiveQueueToken updated) {
    _applyToken(updated);
  }

  void _onPositionUpdate(PositionUpdate update) {
    final current = token;
    if (current == null) return;
    token = current.copyWith(
      position: update.position,
      estimatedWaitMinutes: update.estimatedWaitMinutes,
      // Cleared explicitly, not merged: an update that carries no estimate
      // (the queue's last counter just closed) must replace the previous
      // one rather than leave a stale countdown running.
      estimatedReadyAt: update.estimatedReadyAt,
      clearEstimatedReadyAt: update.estimatedReadyAt == null,
      clearEstimatedWaitMinutes: update.estimatedWaitMinutes == null,
      etaUnavailableReason: update.etaUnavailableReason,
    );
    _maybeAnnounceEtaUpdate(update);
    _maybeShowReminder();
    notifyListeners();
  }

  /// A notice is raised only when the backend says an explicit staff
  /// service-time change caused this recalculation. Ordinary queue movement
  /// carries no reason and passes through silently — the countdown already
  /// shows it — so the customer is never interrupted by the queue simply
  /// advancing.
  ///
  /// A finished token (completed/cancelled/skipped) is never announced to:
  /// there is no waiting time left to update.
  void _maybeAnnounceEtaUpdate(PositionUpdate update) {
    final notice = etaNoticeFor(
      isStaffDurationChange: update.isStaffDurationChange,
      tokenIsActive: token?.isActive ?? false,
      estimatedReadyAt: update.estimatedReadyAt,
      estimatedWaitMinutes: update.estimatedWaitMinutes,
      current: etaUpdateNotice,
    );
    if (notice == null) return;
    etaUpdateNotice = notice;

    final current = token;
    if (current != null) {
      onEtaNotification?.call(
        tokenId: current.id,
        serialNumber: current.serialNumber,
        queueName: _queueName,
        body: notice.estimatedWaitMinutes != null
            ? 'now about ${notice.estimatedWaitMinutes} min'
            : 'your estimated time changed',
      );
    }
  }

  /// Called when the customer closes the notice. Nothing else clears it, so
  /// a rebuild can never resurrect a dismissed popup.
  void dismissEtaUpdateNotice() {
    if (etaUpdateNotice == null) return;
    etaUpdateNotice = null;
    notifyListeners();
  }

  void _onQueueStatusUpdate(QueueStatusUpdate update) {
    final current = token;
    if (current == null || update.queueId != current.queueId) return;
    queuePausedNotice = update.isPaused;
    notifyListeners();
  }

  void _applyToken(LiveQueueToken updated) {
    final previousStatus = token?.status;
    token = updated;

    if (previousStatus != updated.status) {
      // V2 Checkpoint 7 (ADR-029): a fresh code exists only while CALLED —
      // entering CALLED always fetches the current one; leaving it
      // (started/skipped/cancelled/expired-away) always clears the local
      // copy, matching the backend's own lifecycle.
      if (updated.status == TokenStatus.called) {
        unawaited(_refreshVerificationCode());
      } else {
        verificationCode = null;
        verificationCodeExpiresAt = null;
      }
    }

    if (previousStatus != null && previousStatus != updated.status) {
      _onStatusTransition(updated);
    }
    notifyListeners();
  }

  /// Fetches the currently active code for the tracked token — never mints
  /// a new one (that's reissueVerificationCode, an explicit user action).
  Future<void> _refreshVerificationCode() async {
    final current = token;
    if (current == null) return;

    isLoadingVerificationCode = true;
    notifyListeners();
    try {
      final result = await _deviceRepository
          .ensureRegisteredDevice()
          .then((deviceIdentifier) => _tokenRepository.getVerificationCode(current.id, deviceIdentifier));
      verificationCode = result.code;
      verificationCodeExpiresAt = result.expiresAt;
    } catch (_) {
      // No code available yet (or it expired before this fetch landed) —
      // the UI reads null as "not shown," not as an error to surface.
      verificationCode = null;
      verificationCodeExpiresAt = null;
    } finally {
      isLoadingVerificationCode = false;
      notifyListeners();
    }
  }

  /// Explicit customer action — the smallest safe renewal path (backend
  /// section 23). Never called automatically/on a timer.
  Future<void> reissueVerificationCode() async {
    final current = token;
    if (current == null) return;

    isLoadingVerificationCode = true;
    notifyListeners();
    try {
      final deviceIdentifier = await _deviceRepository.ensureRegisteredDevice();
      final result = await _tokenRepository.reissueVerificationCode(current.id, deviceIdentifier);
      verificationCode = result.code;
      verificationCodeExpiresAt = result.expiresAt;
    } catch (_) {
      // Leave whatever was there — the UI's own expiry countdown already
      // communicates staleness; a failed reissue attempt shouldn't erase a
      // still-technically-valid prior code.
    } finally {
      isLoadingVerificationCode = false;
      notifyListeners();
    }
  }

  /// V2 Checkpoint 7 (ADR-029): customer-initiated cancellation, allowed
  /// only while WAITING or CALLED — the backend is the actual authority;
  /// this just surfaces its response. Returns true on success.
  Future<bool> cancelToken() async {
    final current = token;
    if (current == null) return false;

    isCancelling = true;
    notifyListeners();
    try {
      final deviceIdentifier = await _deviceRepository.ensureRegisteredDevice();
      final updated = await _tokenRepository.cancelToken(current.id, deviceIdentifier);
      _applyToken(updated);
      return true;
    } catch (_) {
      return false;
    } finally {
      isCancelling = false;
      notifyListeners();
    }
  }

  void _onStatusTransition(LiveQueueToken updated) {
    onStatusNotification?.call(updated, queueName: _queueName);

    switch (updated.status) {
      case TokenStatus.called:
        _notificationService.showTurnAlert(
          serialNumber: updated.serialNumber,
          counterName: updated.counter?.name,
          soundEnabled: _preferences.soundEnabled,
          vibrationEnabled: _preferences.vibrationEnabled,
        );
        break;
      case TokenStatus.skipped:
        _notificationService.showTokenSkippedNotice(serialNumber: updated.serialNumber);
        break;
      default:
        break;
    }

    if (!updated.isActive) {
      // History keeps the record; the active-token pointer does not. The two
      // are separate concepts, and a finished visit belongs only to the
      // first (ADR-036).
      _historyRepository.recordStatusUpdate(updated.id, updated.status);
      onTokenSettled?.call(updated);
    }
  }

  /// Told when the tracked token reaches a terminal state, so whoever owns
  /// the active-token pointer can drop it. A callback rather than a direct
  /// dependency: this provider already owns the socket session and should
  /// not also reach into app-level navigation state.
  void Function(LiveQueueToken token)? onTokenSettled;

  /// Told on every status transition worth a Notification Center entry
  /// (V2 Product Completion checkpoint, Part D) — a callback for the same
  /// reason as [onTokenSettled]: this provider should not depend on the
  /// Notification Center directly.
  void Function(LiveQueueToken token, {required String queueName})? onStatusNotification;
  void Function({
    required String tokenId,
    required String serialNumber,
    required String queueName,
    required String body,
  })? onEtaNotification;
  void Function({
    required String tokenId,
    required String serialNumber,
    required String queueName,
    required int estimatedWaitMinutes,
  })? onReminderNotification;

  void _maybeShowReminder() {
    if (_reminderShown) return;
    final current = token;
    if (current == null || current.status != TokenStatus.waiting) return;
    final wait = current.estimatedWaitMinutes;
    if (wait == null) return;

    if (wait <= _preferences.reminderMinutesBeforeTurn) {
      _reminderShown = true;
      _notificationService.showReminder(
        serialNumber: current.serialNumber,
        estimatedWaitMinutes: wait,
        soundEnabled: _preferences.soundEnabled,
        vibrationEnabled: _preferences.vibrationEnabled,
      );
      onReminderNotification?.call(
        tokenId: current.id,
        serialNumber: current.serialNumber,
        queueName: _queueName,
        estimatedWaitMinutes: wait,
      );
    }
  }

  /// Tears down subscriptions/room membership without disposing the
  /// ChangeNotifier itself. This provider is a long-lived, app-root
  /// instance (one live-tracking session at a time, reused across screens),
  /// so screens call this from their own `dispose()` rather than relying on
  /// Provider disposing the whole ChangeNotifier when leaving the tracking
  /// screen.
  void stop() {
    _connectionSub?.cancel();
    _lifecycleSub?.cancel();
    _positionSub?.cancel();
    _queueStatusSub?.cancel();
    _fcmDataSub?.cancel();
    _fcmTapSub?.cancel();
    _tokenRepository.stopTracking();
    token = null;
    isConnected = false;
    queuePausedNotice = false;
    verificationCode = null;
    verificationCodeExpiresAt = null;
  }

  @override
  void dispose() {
    stop();
    super.dispose();
  }
}
