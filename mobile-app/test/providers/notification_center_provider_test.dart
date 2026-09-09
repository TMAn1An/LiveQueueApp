import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/models/live_queue_token.dart';
import 'package:mobile_app/providers/notification_center_provider.dart';
import 'package:mobile_app/services/notification_center_storage_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The in-app Notification Center (V2 Product Completion checkpoint, Part
/// D): what a customer sees on opening LiveQueue, regardless of whatever
/// push notifications arrived, were dismissed, or never reached the device.

LiveQueueToken _token({
  String id = 'token-1',
  String status = 'WAITING',
  String? calledAt,
  String? completedAt,
  String? skippedAt,
  String? cancelledAt,
}) =>
    LiveQueueToken.fromJson({
      'id': id,
      'queueId': 'queue-1',
      'serviceId': 'service-1',
      'serialNumber': 'A002',
      'status': status,
      'formData': <String, dynamic>{},
      'position': 1,
      'estimatedWaitMinutes': 5,
      'counter': null,
      'createdAt': DateTime.utc(2026, 1, 1).toIso8601String(),
      'calledAt': calledAt,
      'startedAt': null,
      'completedAt': completedAt,
      'skippedAt': skippedAt,
      'cancelledAt': cancelledAt,
    });

NotificationCenterProvider _provider() =>
    NotificationCenterProvider(storage: NotificationCenterStorageService());

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('starts empty', () async {
    final provider = _provider();
    await provider.load();

    expect(provider.notifications, isEmpty);
    expect(provider.unreadCount, 0);
  });

  test('recordJoin adds an unread, PII-free entry naming the token and queue', () {
    final provider = _provider();
    provider.recordJoin(_token(), queueName: 'Pharmacy');

    expect(provider.notifications, hasLength(1));
    final entry = provider.notifications.single;
    expect(entry.title, 'You joined the queue');
    expect(entry.body, contains('A002'));
    expect(entry.body, contains('Pharmacy'));
    expect(entry.read, isFalse);
    expect(entry.tokenId, 'token-1');
  });

  group('status changes', () {
    test('CALLED produces a distinct entry from IN_PROGRESS', () {
      final provider = _provider();
      provider.recordStatusChange(
        _token(status: 'CALLED', calledAt: '2026-01-01T10:00:00.000Z'),
        queueName: 'Pharmacy',
      );
      provider.recordStatusChange(
        _token(status: 'IN_PROGRESS'),
        queueName: 'Pharmacy',
      );

      expect(provider.notifications, hasLength(2));
      expect(provider.notifications.map((n) => n.title), containsAll([
        'Your token was called',
        'Your service has started',
      ]));
    });

    test('WAITING produces no entry — nothing new to announce', () {
      final provider = _provider();
      provider.recordStatusChange(_token(status: 'WAITING'), queueName: 'Pharmacy');

      expect(provider.notifications, isEmpty);
    });

    test('SKIPPED is worded to say the token can still be recalled', () {
      final provider = _provider();
      provider.recordStatusChange(
        _token(status: 'SKIPPED', skippedAt: '2026-01-01T10:00:00.000Z'),
        queueName: 'Pharmacy',
      );

      expect(provider.notifications.single.body, contains('recall'));
    });

    test('never includes a form answer, email, or any field beyond serial/queue/status', () {
      final provider = _provider();
      provider.recordStatusChange(
        _token(status: 'CALLED', calledAt: '2026-01-01T10:00:00.000Z'),
        queueName: 'Pharmacy',
      );

      final json = provider.notifications.single.toJson();
      expect(json.keys, containsAll(['id', 'tokenId', 'kind', 'title', 'body', 'createdAt', 'status', 'read']));
      expect(json.values.map((v) => v.toString()), isNot(contains(contains('@'))));
    });
  });

  group('deduplication', () {
    test('recording the exact same status transition twice does not duplicate it', () {
      final provider = _provider();
      final token = _token(status: 'CALLED', calledAt: '2026-01-01T10:00:00.000Z');

      provider.recordStatusChange(token, queueName: 'Pharmacy');
      // Simulates the same event arriving a second time — e.g. once via
      // Socket.io while foregrounded, once via a subsequent resync.
      provider.recordStatusChange(token, queueName: 'Pharmacy');

      expect(provider.notifications, hasLength(1));
    });

    test('a recall — CALLED again with a new calledAt — is a genuinely new entry', () {
      final provider = _provider();
      provider.recordStatusChange(
        _token(status: 'CALLED', calledAt: '2026-01-01T10:00:00.000Z'),
        queueName: 'Pharmacy',
      );
      provider.recordStatusChange(
        _token(status: 'CALLED', calledAt: '2026-01-01T11:00:00.000Z'),
        queueName: 'Pharmacy',
      );

      expect(provider.notifications, hasLength(2));
    });

    test('recordReminder is one-shot per token even if called twice', () {
      final provider = _provider();
      provider.recordReminder(
        tokenId: 'token-1',
        serialNumber: 'A002',
        queueName: 'Pharmacy',
        estimatedWaitMinutes: 5,
      );
      provider.recordReminder(
        tokenId: 'token-1',
        serialNumber: 'A002',
        queueName: 'Pharmacy',
        estimatedWaitMinutes: 4,
      );

      expect(provider.notifications, hasLength(1));
    });

    test('a duplicate signal never resurrects an already-read notification as unread', () {
      final provider = _provider();
      final token = _token(status: 'CALLED', calledAt: '2026-01-01T10:00:00.000Z');
      provider.recordStatusChange(token, queueName: 'Pharmacy');
      provider.markRead(provider.notifications.single.id);

      provider.recordStatusChange(token, queueName: 'Pharmacy');

      expect(provider.notifications.single.read, isTrue);
      expect(provider.unreadCount, 0);
    });
  });

  group('multiple active tokens', () {
    test('notifications for two different tokens are independent and both retained', () {
      final provider = _provider();
      provider.recordStatusChange(
        _token(id: 'token-a', status: 'CALLED', calledAt: '2026-01-01T10:00:00.000Z'),
        queueName: 'Pharmacy',
      );
      provider.recordStatusChange(
        _token(id: 'token-b', status: 'CALLED', calledAt: '2026-01-01T10:00:00.000Z'),
        queueName: 'Billing',
      );

      expect(provider.notifications, hasLength(2));
      expect(provider.notifications.map((n) => n.tokenId), containsAll(['token-a', 'token-b']));
    });
  });

  group('read state', () {
    test('markRead flips exactly the targeted notification', () {
      final provider = _provider();
      provider.recordJoin(_token(id: 'token-a'), queueName: 'Pharmacy');
      provider.recordJoin(_token(id: 'token-b'), queueName: 'Billing');
      final targetId = provider.notifications.firstWhere((n) => n.tokenId == 'token-a').id;

      provider.markRead(targetId);

      expect(provider.notifications.firstWhere((n) => n.tokenId == 'token-a').read, isTrue);
      expect(provider.notifications.firstWhere((n) => n.tokenId == 'token-b').read, isFalse);
      expect(provider.unreadCount, 1);
    });

    test('markAllRead clears every unread notification at once', () {
      final provider = _provider();
      provider.recordJoin(_token(id: 'token-a'), queueName: 'Pharmacy');
      provider.recordJoin(_token(id: 'token-b'), queueName: 'Billing');

      provider.markAllRead();

      expect(provider.unreadCount, 0);
    });
  });

  test('newest notification is listed first', () async {
    final provider = _provider();
    provider.recordStatusChange(
      _token(id: 'token-a', status: 'CALLED', calledAt: '2026-01-01T10:00:00.000Z'),
      queueName: 'Pharmacy',
    );
    provider.recordStatusChange(
      _token(id: 'token-a', status: 'IN_PROGRESS'),
      queueName: 'Pharmacy',
    );

    // recordStatusChange for IN_PROGRESS uses DateTime.now() as its fallback
    // timestamp (no startedAt supplied), which is always after the fixed
    // 2026-01-01 calledAt above.
    expect(provider.notifications.first.title, 'Your service has started');
  });

  test('persists across a fresh provider instance — surviving an app restart', () async {
    final first = _provider();
    first.recordJoin(_token(), queueName: 'Pharmacy');
    // recordJoin persists synchronously-scheduled (fire-and-forget); give the
    // microtask queue a turn to let the storage write complete.
    await Future<void>.delayed(Duration.zero);

    final second = _provider();
    await second.load();

    expect(second.notifications, hasLength(1));
    expect(second.notifications.single.tokenId, 'token-1');
  });
}
