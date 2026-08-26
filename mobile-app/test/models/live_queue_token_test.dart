import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/models/live_queue_token.dart';

void main() {
  Map<String, dynamic> baseJson() => {
        'id': 'token-1',
        'queueId': 'queue-1',
        'serviceId': 'service-1',
        'serialNumber': 'A001',
        'status': 'WAITING',
        'formData': {'phone': '555-0100'},
        'position': 3,
        'estimatedWaitMinutes': 12,
        'counter': null,
        'createdAt': '2026-08-22T10:00:00.000Z',
        'calledAt': null,
        'startedAt': null,
        'completedAt': null,
        'skippedAt': null,
      };

  group('LiveQueueToken.fromJson', () {
    test('parses a WAITING token with position/estimatedWaitMinutes', () {
      final token = LiveQueueToken.fromJson(baseJson());
      expect(token.id, 'token-1');
      expect(token.status, TokenStatus.waiting);
      expect(token.position, 3);
      expect(token.estimatedWaitMinutes, 12);
      expect(token.counter, isNull);
      expect(token.formData, {'phone': '555-0100'});
    });

    test('parses a CALLED token with a counter', () {
      final json = baseJson()
        ..['status'] = 'CALLED'
        ..['position'] = null
        ..['estimatedWaitMinutes'] = null
        ..['counter'] = {'id': 'counter-1', 'name': 'Counter 2'};

      final token = LiveQueueToken.fromJson(json);
      expect(token.status, TokenStatus.called);
      expect(token.position, isNull);
      expect(token.counter?.name, 'Counter 2');
    });

    test('maps every backend status string correctly', () {
      for (final entry in {
        'WAITING': TokenStatus.waiting,
        'CALLED': TokenStatus.called,
        'IN_PROGRESS': TokenStatus.inProgress,
        'COMPLETED': TokenStatus.completed,
        'SKIPPED': TokenStatus.skipped,
      }.entries) {
        final token = LiveQueueToken.fromJson(baseJson()..['status'] = entry.key);
        expect(token.status, entry.value, reason: 'for backend status ${entry.key}');
      }
    });

    test('an unrecognized status string maps to unknown rather than throwing', () {
      final token = LiveQueueToken.fromJson(baseJson()..['status'] = 'SOMETHING_NEW');
      expect(token.status, TokenStatus.unknown);
    });

    test('parses estimatedReadyAt when present, and null when absent (V2 Checkpoint 4)', () {
      final withReadyAt = LiveQueueToken.fromJson(
        baseJson()..['estimatedReadyAt'] = '2026-08-22T10:12:00.000Z',
      );
      expect(withReadyAt.estimatedReadyAt, DateTime.parse('2026-08-22T10:12:00.000Z'));

      final withoutReadyAt = LiveQueueToken.fromJson(baseJson());
      expect(withoutReadyAt.estimatedReadyAt, isNull);
    });
  });

  group('LiveQueueToken.isActive', () {
    test('is true for waiting/called/inProgress', () {
      for (final status in [TokenStatus.waiting, TokenStatus.called, TokenStatus.inProgress]) {
        final token = LiveQueueToken.fromJson(baseJson()..['status'] = _wireStatus(status));
        expect(token.isActive, isTrue, reason: 'for $status');
      }
    });

    test('is false for completed/skipped', () {
      for (final status in [TokenStatus.completed, TokenStatus.skipped]) {
        final token = LiveQueueToken.fromJson(baseJson()..['status'] = _wireStatus(status));
        expect(token.isActive, isFalse, reason: 'for $status');
      }
    });
  });

  group('LiveQueueToken.copyWith', () {
    test('clearPosition/clearEstimatedWaitMinutes null out those fields', () {
      final token = LiveQueueToken.fromJson(baseJson());
      final updated = token.copyWith(
        status: TokenStatus.called,
        clearPosition: true,
        clearEstimatedWaitMinutes: true,
      );
      expect(updated.status, TokenStatus.called);
      expect(updated.position, isNull);
      expect(updated.estimatedWaitMinutes, isNull);
    });

    test('applies a position/estimatedWaitMinutes update without touching other fields', () {
      final token = LiveQueueToken.fromJson(baseJson());
      final updated = token.copyWith(position: 1, estimatedWaitMinutes: 4);
      expect(updated.position, 1);
      expect(updated.estimatedWaitMinutes, 4);
      expect(updated.status, token.status);
      expect(updated.serialNumber, token.serialNumber);
    });
  });

  group('TokenStatusSnapshot.fromJson', () {
    test('parses the lightweight /status shape', () {
      final snapshot = TokenStatusSnapshot.fromJson({
        'id': 'token-1',
        'status': 'WAITING',
        'position': 2,
        'estimatedWaitMinutes': 8,
        'estimatedReadyAt': '2026-08-22T10:08:00.000Z',
      });
      expect(snapshot.id, 'token-1');
      expect(snapshot.status, TokenStatus.waiting);
      expect(snapshot.position, 2);
      expect(snapshot.estimatedWaitMinutes, 8);
      expect(snapshot.estimatedReadyAt, DateTime.parse('2026-08-22T10:08:00.000Z'));
    });
  });
}

String _wireStatus(TokenStatus status) {
  switch (status) {
    case TokenStatus.waiting:
      return 'WAITING';
    case TokenStatus.called:
      return 'CALLED';
    case TokenStatus.inProgress:
      return 'IN_PROGRESS';
    case TokenStatus.completed:
      return 'COMPLETED';
    case TokenStatus.skipped:
      return 'SKIPPED';
    case TokenStatus.unknown:
      return 'UNKNOWN';
  }
}
