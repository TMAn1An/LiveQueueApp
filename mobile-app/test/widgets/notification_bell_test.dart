import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/models/live_queue_token.dart';
import 'package:mobile_app/providers/notification_center_provider.dart';
import 'package:mobile_app/services/notification_center_storage_service.dart';
import 'package:mobile_app/widgets/notification_bell.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

LiveQueueToken _token() => LiveQueueToken.fromJson({
      'id': 'token-1',
      'queueId': 'queue-1',
      'serviceId': 'service-1',
      'serialNumber': 'A002',
      'status': 'CALLED',
      'formData': <String, dynamic>{},
      'position': 1,
      'estimatedWaitMinutes': 5,
      'counter': null,
      'createdAt': DateTime.utc(2026, 1, 1).toIso8601String(),
      'calledAt': DateTime.utc(2026, 1, 1).toIso8601String(),
      'startedAt': null,
      'completedAt': null,
      'skippedAt': null,
    });

Widget _bellUnder(NotificationCenterProvider provider) {
  return ChangeNotifierProvider<NotificationCenterProvider>.value(
    value: provider,
    child: const MaterialApp(home: Scaffold(appBar: null, body: NotificationBell())),
  );
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('shows no badge when there is nothing unread', (tester) async {
    final provider = NotificationCenterProvider(storage: NotificationCenterStorageService());
    await provider.load();

    await tester.pumpWidget(_bellUnder(provider));

    expect(find.text('1'), findsNothing);
  });

  testWidgets('shows the unread count as a badge', (tester) async {
    final provider = NotificationCenterProvider(storage: NotificationCenterStorageService());
    await provider.load();
    provider.recordJoin(_token(), queueName: 'Pharmacy');

    await tester.pumpWidget(_bellUnder(provider));

    expect(find.text('1'), findsOneWidget);
  });

  testWidgets('caps the visible badge at "9+"', (tester) async {
    final provider = NotificationCenterProvider(storage: NotificationCenterStorageService());
    await provider.load();
    for (var i = 0; i < 12; i++) {
      provider.recordStatusChange(
        LiveQueueToken.fromJson({
          'id': 'token-$i',
          'queueId': 'queue-$i',
          'serviceId': 'service-1',
          'serialNumber': 'A00$i',
          'status': 'CALLED',
          'formData': <String, dynamic>{},
          'position': 1,
          'estimatedWaitMinutes': 5,
          'counter': null,
          'createdAt': DateTime.utc(2026, 1, 1).toIso8601String(),
          'calledAt': DateTime.utc(2026, 1, 1, 0, i).toIso8601String(),
          'startedAt': null,
          'completedAt': null,
          'skippedAt': null,
        }),
        queueName: 'Pharmacy',
      );
    }

    await tester.pumpWidget(_bellUnder(provider));

    expect(find.text('9+'), findsOneWidget);
  });
}
