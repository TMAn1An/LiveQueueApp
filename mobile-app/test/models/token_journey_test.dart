import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/models/live_queue_token.dart';

void main() {
  group('ADR-070 journey and ADR-069 queue removal', () {
    Map<String, dynamic> base() => {
          'id': 't1',
          'queueId': 'q1',
          'serviceId': 's1',
          'serialNumber': 'A001',
          'status': 'WAITING',
          'createdAt': '2026-10-03T10:00:00.000Z',
        };

    test('parses the read-only journey: current, next and referral', () {
      final token = LiveQueueToken.fromJson({
        ...base(),
        'journey': {
          'totalSteps': 3,
          'currentStepNumber': 2,
          'referredTo': {'id': 'c2', 'name': 'Pay 1'},
          'steps': [
            {'stepNumber': 1, 'serviceId': 's1', 'serviceName': 'Registration', 'status': 'COMPLETED', 'counter': {'id': 'c1', 'name': 'Desk 1'}},
            {'stepNumber': 2, 'serviceId': 's2', 'serviceName': 'Payment', 'status': 'PENDING', 'counter': null},
            {'stepNumber': 3, 'serviceId': 's1', 'serviceName': 'Registration', 'status': 'PENDING', 'counter': null},
          ],
        },
      });
      expect(token.journey!.current!.serviceName, 'Payment');
      expect(token.journey!.next!.stepNumber, 3);
      expect(token.journey!.referredToCounterName, 'Pay 1');
      expect(token.journey!.steps.first.isDone, isTrue);
      expect(token.copyWith(position: 2).journey, isNotNull);
    });

    test('a token from before journeys has none, and no removal notice', () {
      final token = LiveQueueToken.fromJson(base());
      expect(token.journey, isNull);
      expect(token.queueRemoved, isFalse);
    });

    test('a visit cancelled because its queue was deleted carries the reason', () {
      final token = LiveQueueToken.fromJson({
        ...base(),
        'status': 'CANCELLED',
        'queueRemoved': {'reason': 'Clinic closed.'},
      });
      expect(token.queueRemoved, isTrue);
      expect(token.queueRemovedReason, 'Clinic closed.');
    });
  });
}
