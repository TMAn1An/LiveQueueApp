import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/models/history_entry.dart';
import 'package:mobile_app/models/live_queue_token.dart';

void main() {
  test('toJson/fromJson round-trips exactly', () {
    final entry = HistoryEntry(
      tokenId: 'token-1',
      queueId: 'queue-1',
      queueName: 'Customer Service',
      serviceId: 'service-1',
      serviceName: 'General Inquiry',
      serialNumber: 'A007',
      createdAt: DateTime.utc(2026, 8, 22, 10, 30),
      finalStatus: TokenStatus.completed,
    );

    final restored = HistoryEntry.fromJson(entry.toJson());

    expect(restored.tokenId, entry.tokenId);
    expect(restored.queueId, entry.queueId);
    expect(restored.queueName, entry.queueName);
    expect(restored.serviceId, entry.serviceId);
    expect(restored.serviceName, entry.serviceName);
    expect(restored.serialNumber, entry.serialNumber);
    expect(restored.createdAt, entry.createdAt);
    expect(restored.finalStatus, entry.finalStatus);
  });

  test('copyWith updates only the final status', () {
    final entry = HistoryEntry(
      tokenId: 'token-1',
      queueId: 'queue-1',
      queueName: 'Customer Service',
      serviceId: 'service-1',
      serviceName: 'General Inquiry',
      serialNumber: 'A007',
      createdAt: DateTime.utc(2026, 8, 22, 10, 30),
      finalStatus: TokenStatus.waiting,
    );

    final updated = entry.copyWith(finalStatus: TokenStatus.skipped);

    expect(updated.finalStatus, TokenStatus.skipped);
    expect(updated.tokenId, entry.tokenId);
    expect(updated.serialNumber, entry.serialNumber);
  });

  test('an unrecognized stored status falls back to unknown rather than throwing', () {
    final json = {
      'tokenId': 'token-1',
      'queueId': 'queue-1',
      'queueName': 'Q',
      'serviceId': 'service-1',
      'serviceName': 'S',
      'serialNumber': 'A001',
      'createdAt': DateTime.utc(2026, 1, 1).toIso8601String(),
      'finalStatus': 'not_a_real_status',
    };
    expect(HistoryEntry.fromJson(json).finalStatus, TokenStatus.unknown);
  });
}
