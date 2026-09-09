// V2 Product Completion checkpoint, Part B: Clear Token History is a
// permanent local deletion and must ask first — Cancel must leave history
// untouched, Confirm must actually clear it, and active tokens must never
// be affected either way.

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/models/history_entry.dart';
import 'package:mobile_app/models/live_queue_token.dart';
import 'package:mobile_app/providers/active_token_provider.dart';
import 'package:mobile_app/repositories/device_repository.dart';
import 'package:mobile_app/repositories/history_repository.dart';
import 'package:mobile_app/screens/settings_screen.dart';
import 'package:mobile_app/services/active_token_storage_service.dart';
import 'package:mobile_app/services/api_client.dart';
import 'package:mobile_app/services/device_api_service.dart';
import 'package:mobile_app/services/device_identity_service.dart';
import 'package:mobile_app/services/history_storage_service.dart';
import 'package:mobile_app/services/socket_service.dart';
import 'package:mobile_app/services/token_api_service.dart';
import 'package:mobile_app/repositories/token_repository.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

Widget _appUnder(HistoryRepository history, ActiveTokenProvider active) {
  final apiClient = ApiClient(
    httpClient: MockClient(
      (_) async => http.Response(jsonEncode({'success': true, 'data': {'deviceId': 'device-1'}}), 200),
    ),
    baseUrl: 'http://localhost:4000',
  );
  return MultiProvider(
    providers: [
      Provider<DeviceRepository>(
        create: (_) => DeviceRepository(
          identityService: DeviceIdentityService(),
          apiService: DeviceApiService(apiClient),
        ),
      ),
      Provider<HistoryRepository>.value(value: history),
      ChangeNotifierProvider<ActiveTokenProvider>.value(value: active),
    ],
    child: const MaterialApp(home: SettingsScreen()),
  );
}

ActiveTokenProvider _activeTokenProvider() => ActiveTokenProvider(
      tokenRepository: TokenRepository(
        apiService: TokenApiService(ApiClient(baseUrl: 'http://localhost:4000')),
        socketService: SocketService(),
      ),
      storage: ActiveTokenStorageService(),
    );

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('tapping Clear Token History opens a confirmation dialog', (tester) async {
    final history = HistoryRepository(storageService: HistoryStorageService());
    await tester.pumpWidget(_appUnder(history, _activeTokenProvider()));

    await tester.tap(find.text('Clear Token History'));
    await tester.pumpAndSettle();

    expect(find.text('Clear token history?'), findsOneWidget);
    expect(find.textContaining('Active tokens will not be removed'), findsOneWidget);
    expect(find.widgetWithText(TextButton, 'Cancel'), findsOneWidget);
    expect(find.widgetWithText(TextButton, 'Clear'), findsOneWidget);
  });

  testWidgets('Cancel leaves history intact and closes the dialog', (tester) async {
    final history = HistoryRepository(storageService: HistoryStorageService());
    await history.recordJoin(HistoryEntry(
      tokenId: 'token-1',
      queueId: 'queue-1',
      serialNumber: 'A001',
      queueName: 'Pharmacy',
      serviceId: 'service-1',
      serviceName: 'General',
      createdAt: DateTime.utc(2026, 1, 1),
      finalStatus: TokenStatus.completed,
    ));
    final active = _activeTokenProvider();
    await tester.pumpWidget(_appUnder(history, active));

    await tester.tap(find.text('Clear Token History'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
    await tester.pumpAndSettle();

    expect(find.text('Clear token history?'), findsNothing);
    final entries = await history.getHistory();
    expect(entries, hasLength(1));
  });

  testWidgets('Confirm actually clears history', (tester) async {
    final history = HistoryRepository(storageService: HistoryStorageService());
    await history.recordJoin(HistoryEntry(
      tokenId: 'token-1',
      queueId: 'queue-1',
      serialNumber: 'A001',
      queueName: 'Pharmacy',
      serviceId: 'service-1',
      serviceName: 'General',
      createdAt: DateTime.utc(2026, 1, 1),
      finalStatus: TokenStatus.completed,
    ));
    await tester.pumpWidget(_appUnder(history, _activeTokenProvider()));

    await tester.tap(find.text('Clear Token History'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Clear'));
    await tester.pumpAndSettle();

    expect(find.text('Token history cleared.'), findsOneWidget);
    final entries = await history.getHistory();
    expect(entries, isEmpty);
  });

  testWidgets('clearing history never touches a remembered active token', (tester) async {
    final history = HistoryRepository(storageService: HistoryStorageService());
    final active = _activeTokenProvider();
    await active.remember(
      LiveQueueToken.fromJson({
        'id': 'token-1',
        'queueId': 'queue-1',
        'serviceId': 'service-1',
        'serialNumber': 'A001',
        'status': 'WAITING',
        'formData': <String, dynamic>{},
        'position': 1,
        'estimatedWaitMinutes': 5,
        'counter': null,
        'createdAt': DateTime.utc(2026, 1, 1).toIso8601String(),
        'calledAt': null,
        'startedAt': null,
        'completedAt': null,
        'skippedAt': null,
      }),
      queueName: 'Pharmacy',
    );

    await tester.pumpWidget(_appUnder(history, active));
    await tester.tap(find.text('Clear Token History'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Clear'));
    await tester.pumpAndSettle();

    expect(active.hasActiveToken, isTrue);
    expect(active.summaryFor('token-1'), isNotNull);
  });
}
