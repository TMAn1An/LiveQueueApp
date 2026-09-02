import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/providers/queue_join_provider.dart';
import 'package:mobile_app/repositories/device_repository.dart';
import 'package:mobile_app/repositories/history_repository.dart';
import 'package:mobile_app/repositories/queue_repository.dart';
import 'package:mobile_app/repositories/token_repository.dart';
import 'package:mobile_app/screens/service_selection_screen.dart';
import 'package:mobile_app/services/api_client.dart';
import 'package:mobile_app/services/device_api_service.dart';
import 'package:mobile_app/services/device_identity_service.dart';
import 'package:mobile_app/services/history_storage_service.dart';
import 'package:mobile_app/services/queue_api_service.dart';
import 'package:mobile_app/services/socket_service.dart';
import 'package:mobile_app/services/token_api_service.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// V2 Checkpoint 5 (ADR-027): checkbox-style multi-selection — proves the
/// actual tap interaction, not a pixel snapshot.
Map<String, dynamic> _queueJson() => {
      'id': 'queue-1',
      'name': 'Customer Service',
      'description': null,
      'status': 'ACTIVE',
      'clientTerminology': null,
      'services': [
        {'id': 'service-1', 'serviceName': 'General Inquiry', 'description': null, 'durationMinutes': 5},
        {'id': 'service-2', 'serviceName': 'Document Check', 'description': null, 'durationMinutes': 7},
      ],
      'formFields': <Map<String, dynamic>>[],
    };

Future<QueueJoinProvider> _buildLoadedProvider() async {
  final mockClient = MockClient((request) async {
    return http.Response(jsonEncode({'success': true, 'data': _queueJson()}), 200);
  });
  final apiClient = ApiClient(httpClient: mockClient, baseUrl: 'http://localhost:4000');
  final provider = QueueJoinProvider(
    queueRepository: QueueRepository(apiService: QueueApiService(apiClient)),
    tokenRepository: TokenRepository(apiService: TokenApiService(apiClient), socketService: SocketService()),
    deviceRepository: DeviceRepository(
      identityService: DeviceIdentityService(),
      apiService: DeviceApiService(apiClient),
    ),
    historyRepository: HistoryRepository(storageService: HistoryStorageService()),
  );
  await provider.loadQueueById('queue-1');
  return provider;
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  Future<void> pump(WidgetTester tester, QueueJoinProvider provider) {
    return tester.pumpWidget(
      MaterialApp(
        home: ChangeNotifierProvider<QueueJoinProvider>.value(
          value: provider,
          child: const ServiceSelectionScreen(),
        ),
      ),
    );
  }

  testWidgets('checking two services selects both, sums the duration, and enables Next', (tester) async {
    final provider = await _buildLoadedProvider();
    await pump(tester, provider);

    expect(find.text('Estimated service time: 0 minutes'), findsOneWidget);
    final nextButtonBefore = tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Next'));
    expect(nextButtonBefore.onPressed, isNull);

    await tester.tap(find.widgetWithText(CheckboxListTile, 'General Inquiry'));
    await tester.pump();
    await tester.tap(find.widgetWithText(CheckboxListTile, 'Document Check'));
    await tester.pump();

    expect(find.text('Estimated service time: 12 minutes'), findsOneWidget);
    final nextButtonAfter = tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Next'));
    expect(nextButtonAfter.onPressed, isNotNull);
  });

  testWidgets('unchecking a service removes only that one from the total', (tester) async {
    final provider = await _buildLoadedProvider();
    await pump(tester, provider);

    await tester.tap(find.widgetWithText(CheckboxListTile, 'General Inquiry'));
    await tester.pump();
    await tester.tap(find.widgetWithText(CheckboxListTile, 'Document Check'));
    await tester.pump();
    expect(find.text('Estimated service time: 12 minutes'), findsOneWidget);

    await tester.tap(find.widgetWithText(CheckboxListTile, 'General Inquiry'));
    await tester.pump();

    expect(find.text('Estimated service time: 7 minutes'), findsOneWidget);
    expect(provider.selectedServiceIds, {'service-2'});
  });
}
