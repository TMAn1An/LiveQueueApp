import 'dart:async';

import 'package:flutter/foundation.dart';

import '../models/live_queue_token.dart';
import '../models/notification_preferences.dart';
import '../repositories/history_repository.dart';
import '../repositories/token_repository.dart';
import '../services/notification_service.dart';

/// Live-tracks a single token via Socket.io, with REST as the fallback
/// source of truth (spec section 26: "refresh token status after
/// reconnecting" — every reconnect triggers a REST resync here, never
/// relying on missed events being replayed, matching Phase 4's own "no
/// event replay" design).
class TokenTrackingProvider extends ChangeNotifier {
  TokenTrackingProvider({
    required TokenRepository tokenRepository,
    required HistoryRepository historyRepository,
    required NotificationService notificationService,
  })  : _tokenRepository = tokenRepository,
        _historyRepository = historyRepository,
        _notificationService = notificationService;

  final TokenRepository _tokenRepository;
  final HistoryRepository _historyRepository;
  final NotificationService _notificationService;

  LiveQueueToken? token;
  bool isConnected = false;
  bool isResyncing = false;
  String? errorMessage;
  bool queuePausedNotice = false;

  NotificationPreferences _preferences = const NotificationPreferences();
  bool _reminderShown = false;

  StreamSubscription<bool>? _connectionSub;
  StreamSubscription<LiveQueueToken>? _lifecycleSub;
  StreamSubscription<PositionUpdate>? _positionSub;
  StreamSubscription<QueueStatusUpdate>? _queueStatusSub;

  void start(LiveQueueToken initialToken, NotificationPreferences preferences) {
    token = initialToken;
    _preferences = preferences;
    _reminderShown = false;

    _tokenRepository.connectSocket();
    _tokenRepository.joinTokenRoom(initialToken.id);
    _tokenRepository.joinQueueRoom(initialToken.queueId);

    _connectionSub = _tokenRepository.connectionStatus.listen(_onConnectionChanged);
    _lifecycleSub = _tokenRepository.tokenLifecycleUpdates.listen(_onLifecycleUpdate);
    _positionSub = _tokenRepository.positionUpdates.listen(_onPositionUpdate);
    _queueStatusSub = _tokenRepository.queueStatusUpdates.listen(_onQueueStatusUpdate);
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
    );
    _maybeShowReminder();
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

    if (previousStatus != null && previousStatus != updated.status) {
      _onStatusTransition(updated);
    }
    notifyListeners();
  }

  void _onStatusTransition(LiveQueueToken updated) {
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
      _historyRepository.recordStatusUpdate(updated.id, updated.status);
    }
  }

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
    _tokenRepository.stopTracking();
    token = null;
    isConnected = false;
    queuePausedNotice = false;
  }

  @override
  void dispose() {
    stop();
    super.dispose();
  }
}
