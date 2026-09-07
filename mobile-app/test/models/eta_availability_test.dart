import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/models/live_queue_token.dart';

Map<String, dynamic> _tokenJson({Object? estimatedReadyAt, Object? etaUnavailableReason}) => {
  'id': 'token-1',
  'queueId': 'queue-1',
  'serviceId': 'service-1',
  'serialNumber': 'A001',
  'status': 'WAITING',
  'formData': <String, dynamic>{},
  'position': 1,
  'estimatedWaitMinutes': estimatedReadyAt == null ? null : 12,
  'estimatedReadyAt': estimatedReadyAt,
  'etaUnavailableReason': etaUnavailableReason,
  'counter': null,
  'createdAt': '2026-09-08T10:00:00.000Z',
};

void main() {
  group('ETA availability', () {
    test('reads the backend reason for a missing estimate', () {
      final token = LiveQueueToken.fromJson(
        _tokenJson(etaUnavailableReason: 'NO_ACTIVE_COUNTER'),
      );

      expect(token.estimatedReadyAt, isNull);
      expect(token.isWaitingForActiveCounter, isTrue);
    });

    test('treats an unknown or absent reason as merely unavailable', () {
      expect(LiveQueueToken.fromJson(_tokenJson()).isWaitingForActiveCounter, isFalse);
      expect(
        LiveQueueToken.fromJson(_tokenJson(etaUnavailableReason: 'SOMETHING_NEW'))
            .isWaitingForActiveCounter,
        isFalse,
      );
    });

    test('carries no reason once an estimate exists', () {
      final token = LiveQueueToken.fromJson(
        _tokenJson(estimatedReadyAt: '2026-09-08T10:12:00.000Z'),
      );

      expect(token.estimatedReadyAt, isNotNull);
      expect(token.isWaitingForActiveCounter, isFalse);
    });

    /// A counter opening must be able to clear the message, and a counter
    /// closing must be able to restore it — copyWith replaces the reason
    /// outright rather than merging, so neither can go stale.
    test('a live update replaces the previous reason instead of keeping it', () {
      final waitingForCounter = LiveQueueToken.fromJson(
        _tokenJson(etaUnavailableReason: 'NO_ACTIVE_COUNTER'),
      );

      final counterOpened = waitingForCounter.copyWith(
        estimatedReadyAt: DateTime.utc(2026, 9, 8, 10, 12),
        estimatedWaitMinutes: 12,
      );
      expect(counterOpened.isWaitingForActiveCounter, isFalse);
      expect(counterOpened.estimatedReadyAt, isNotNull);

      final counterClosed = counterOpened.copyWith(
        clearEstimatedReadyAt: true,
        clearEstimatedWaitMinutes: true,
        etaUnavailableReason: 'NO_ACTIVE_COUNTER',
      );
      expect(counterClosed.estimatedReadyAt, isNull);
      expect(counterClosed.isWaitingForActiveCounter, isTrue);
    });
  });
}
