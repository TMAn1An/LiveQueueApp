import 'dart:async';

import 'package:flutter/foundation.dart';

import '../models/app_notification.dart';
import '../models/live_queue_token.dart';
import '../services/notification_center_storage_service.dart';

/// The in-app Notification Center's state (V2 Product Completion
/// checkpoint, Part D): what a customer sees on opening LiveQueue,
/// independent of whatever Android push notifications arrived or were
/// dismissed while the app was closed.
///
/// Fed from three places, deliberately none of them a new backend concept:
///  - joining a queue (TokenConfirmationScreen)
///  - a status transition on the token currently open in Live Tracking
///    (TokenTrackingProvider, while foregrounded)
///  - a resync of *any* remembered token noticing its status changed since
///    it was last seen (ActiveTokenProvider, covers a token that is not
///    the one currently open, and the case where the app was closed and no
///    push happened to arrive)
///
/// Every entry carries its own [AppNotification.id] built from the
/// underlying event's own identity (a token id plus its own per-status
/// timestamp where one exists), so recording the same logical event twice —
/// once from Socket.io, once from a resync — is a no-op rather than a
/// duplicate row. See [_upsert].
class NotificationCenterProvider extends ChangeNotifier {
  NotificationCenterProvider({required NotificationCenterStorageService storage})
      : _storage = storage;

  final NotificationCenterStorageService _storage;

  List<AppNotification> _notifications = [];
  bool isLoading = true;

  /// Newest first, regardless of storage order.
  List<AppNotification> get notifications =>
      List.unmodifiable(_notifications.toList()..sort((a, b) => b.createdAt.compareTo(a.createdAt)));

  int get unreadCount => _notifications.where((n) => !n.read).length;

  Future<void> load() async {
    isLoading = true;
    notifyListeners();
    _notifications = await _storage.readAll();
    isLoading = false;
    notifyListeners();
  }

  void recordJoin(LiveQueueToken token, {required String queueName}) {
    _upsert(AppNotification(
      id: '${token.id}:joined',
      tokenId: token.id,
      kind: NotificationKind.joined,
      title: 'You joined the queue',
      body: queueName.isEmpty ? 'Token ${token.serialNumber}' : '${token.serialNumber} · $queueName',
      createdAt: token.createdAt,
      status: token.status,
    ));
  }

  /// Builds the right entry for whatever [token.status] currently is. Called
  /// both for the actively-tracked token (on a real transition) and for any
  /// other remembered token a resync just noticed changed — the two share
  /// this one path so the wording is never allowed to drift between them.
  void recordStatusChange(LiveQueueToken token, {required String queueName}) {
    final content = _statusContent(token, queueName);
    if (content == null) return; // WAITING has nothing new to announce.

    _upsert(AppNotification(
      id: '${token.id}:${token.status.name}:${content.$3.toIso8601String()}',
      tokenId: token.id,
      kind: NotificationKind.statusChanged,
      title: content.$1,
      body: content.$2,
      createdAt: content.$3,
      status: token.status,
    ));
  }

  /// (title, body, the specific per-status timestamp this transition set)
  (String, String, DateTime)? _statusContent(LiveQueueToken token, String queueName) {
    final where = queueName.isEmpty ? '' : ' · $queueName';
    switch (token.status) {
      case TokenStatus.called:
        return (
          'Your token was called',
          '${token.serialNumber}$where',
          token.calledAt ?? DateTime.now(),
        );
      case TokenStatus.inProgress:
        return (
          'Your service has started',
          '${token.serialNumber}$where',
          token.startedAt ?? DateTime.now(),
        );
      case TokenStatus.completed:
        return (
          'Token completed',
          '${token.serialNumber}$where',
          token.completedAt ?? DateTime.now(),
        );
      case TokenStatus.skipped:
        return (
          'Your token was skipped',
          '${token.serialNumber}$where — staff can still recall it',
          token.skippedAt ?? DateTime.now(),
        );
      case TokenStatus.cancelled:
        return (
          'Token cancelled',
          '${token.serialNumber}$where',
          token.cancelledAt ?? DateTime.now(),
        );
      case TokenStatus.waiting:
      case TokenStatus.unknown:
        return null;
    }
  }

  /// Only for a change the app already decided was worth surfacing as a
  /// dismissible notice (see `etaNoticeFor` in TokenTrackingProvider) — this
  /// records the same event as a Notification Center entry rather than
  /// re-deciding whether it was meaningful.
  void recordEtaChanged({
    required String tokenId,
    required String serialNumber,
    required String queueName,
    required String body,
  }) {
    final where = queueName.isEmpty ? '' : ' · $queueName';
    _upsert(AppNotification(
      id: '$tokenId:eta:${DateTime.now().microsecondsSinceEpoch}',
      tokenId: tokenId,
      kind: NotificationKind.etaChanged,
      title: 'Estimated wait updated',
      body: '$serialNumber$where — $body',
      createdAt: DateTime.now(),
    ));
  }

  /// One-shot per token by construction (`${tokenId}:reminder` never
  /// varies), matching TokenTrackingProvider's own `_reminderShown` guard —
  /// belt and suspenders, since [_upsert] would no-op a second call anyway.
  void recordReminder({
    required String tokenId,
    required String serialNumber,
    required String queueName,
    required int estimatedWaitMinutes,
  }) {
    final where = queueName.isEmpty ? '' : ' · $queueName';
    _upsert(AppNotification(
      id: '$tokenId:reminder',
      tokenId: tokenId,
      kind: NotificationKind.reminder,
      title: 'Your turn is coming up',
      body: '$serialNumber$where — about $estimatedWaitMinutes min left',
      createdAt: DateTime.now(),
    ));
  }

  void markRead(String id) {
    final index = _notifications.indexWhere((n) => n.id == id);
    if (index == -1 || _notifications[index].read) return;
    _notifications = [
      ..._notifications.sublist(0, index),
      _notifications[index].copyWith(read: true),
      ..._notifications.sublist(index + 1),
    ];
    notifyListeners();
    unawaited(_storage.saveAll(_notifications));
  }

  void markAllRead() {
    if (unreadCount == 0) return;
    _notifications = _notifications.map((n) => n.copyWith(read: true)).toList();
    notifyListeners();
    unawaited(_storage.saveAll(_notifications));
  }

  /// Inserts [notification] only if its id is not already present — an
  /// existing entry (read or not) is left completely untouched, so a
  /// duplicate signal for the same event can never resurrect a
  /// already-read notification as unread.
  void _upsert(AppNotification notification) {
    if (_notifications.any((n) => n.id == notification.id)) return;
    _notifications = [..._notifications, notification];
    notifyListeners();
    unawaited(_storage.saveAll(_notifications));
  }
}
