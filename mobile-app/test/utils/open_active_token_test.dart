// Centered Foreground Notification phase: "View" on a card about a token
// that is no longer active must land on that token's own History details
// (or the History list, if the entry cannot be found) instead of just a
// toast telling the customer to go look for it themselves. Covers the one
// branch `open_active_token_test`-adjacent integration coverage doesn't
// already exercise (that coverage only ever hits the still-active path).

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/models/history_entry.dart';
import 'package:mobile_app/models/live_queue_token.dart';
import 'package:mobile_app/providers/active_token_provider.dart';
import 'package:mobile_app/providers/history_provider.dart';
import 'package:mobile_app/providers/notification_preferences_provider.dart';
import 'package:mobile_app/providers/token_tracking_provider.dart';
import 'package:mobile_app/repositories/device_repository.dart';
import 'package:mobile_app/repositories/history_repository.dart';
import 'package:mobile_app/repositories/notification_preferences_repository.dart';
import 'package:mobile_app/repositories/token_repository.dart';
import 'package:mobile_app/screens/live_tracking_screen.dart';
import 'package:mobile_app/screens/token_details_screen.dart';
import 'package:mobile_app/screens/token_history_screen.dart';
import 'package:mobile_app/services/active_token_storage_service.dart';
import 'package:mobile_app/services/api_client.dart';
import 'package:mobile_app/services/device_api_service.dart';
import 'package:mobile_app/services/device_identity_service.dart';
import 'package:mobile_app/services/fcm_service.dart';
import 'package:mobile_app/services/history_storage_service.dart';
import 'package:mobile_app/services/notification_service.dart';
import 'package:mobile_app/services/preferences_storage_service.dart';
import 'package:mobile_app/services/socket_service.dart';
import 'package:mobile_app/services/token_api_service.dart';
import 'package:mobile_app/utils/open_active_token.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

LiveQueueToken buildToken({required String id, required String status}) => LiveQueueToken.fromJson({
      'id': id,
      'queueId': 'queue-a',
      'serviceId': 'service-1',
      'serialNumber': 'A002',
      'status': status,
      'formData': <String, dynamic>{},
      'position': 1,
      'estimatedWaitMinutes': 5,
      'counter': null,
      'createdAt': DateTime.utc(2026, 1, 1).toIso8601String(),
      'calledAt': null,
      'startedAt': null,
      'completedAt': status == 'COMPLETED' ? DateTime.utc(2026, 1, 1, 1).toIso8601String() : null,
      'skippedAt': null,
    });

http.Response ok(Map<String, dynamic> data) => http.Response(jsonEncode({'success': true, 'data': data}), 200);

class _StubTracking extends TokenTrackingProvider {
  _StubTracking(ApiClient client)
      : super(
          tokenRepository: TokenRepository(apiService: TokenApiService(client), socketService: SocketService()),
          deviceRepository:
              DeviceRepository(identityService: DeviceIdentityService(), apiService: DeviceApiService(client)),
          historyRepository: HistoryRepository(storageService: HistoryStorageService()),
          notificationService: NotificationService(),
          fcmService: FcmService(notificationService: NotificationService()),
        );
}

Widget appUnder({
  required ApiClient apiClient,
  required ActiveTokenProvider activeToken,
  required HistoryRepository historyRepository,
}) {
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<ActiveTokenProvider>.value(value: activeToken),
      Provider<HistoryRepository>.value(value: historyRepository),
      ChangeNotifierProvider<HistoryProvider>(
        create: (context) => HistoryProvider(historyRepository: context.read<HistoryRepository>()),
      ),
      ChangeNotifierProvider<TokenTrackingProvider>(create: (_) => _StubTracking(apiClient)),
      ChangeNotifierProvider<NotificationPreferencesProvider>(
        create: (_) => NotificationPreferencesProvider(
          repository: NotificationPreferencesRepository(storageService: PreferencesStorageService()),
          notificationService: NotificationService(),
        ),
      ),
    ],
    child: MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: Center(
            child: ElevatedButton(
              onPressed: () => openActiveToken(context, 'token-a'),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ),
  );
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('a terminal token with a matching History entry opens its own details', (tester) async {
    final apiClient = ApiClient(
      httpClient: MockClient((_) async => ok(buildToken(id: 'token-a', status: 'COMPLETED').toJsonForTest())),
      baseUrl: 'http://localhost:4000',
    );
    final activeToken = ActiveTokenProvider(
      tokenRepository: TokenRepository(apiService: TokenApiService(apiClient), socketService: SocketService()),
      storage: ActiveTokenStorageService(),
    );
    // Never remembered locally — resyncOne short-circuits to null with no
    // network call, exactly like tapping a Notification Center entry for a
    // token this installation no longer tracks as active.
    final historyRepository = HistoryRepository(storageService: HistoryStorageService());
    await historyRepository.recordJoin(HistoryEntry(
      tokenId: 'token-a',
      queueId: 'queue-a',
      queueName: 'Pharmacy',
      serviceId: 'service-1',
      serviceName: 'General',
      serialNumber: 'A002',
      createdAt: DateTime.utc(2026, 1, 1),
      finalStatus: TokenStatus.completed,
    ));

    await tester.pumpWidget(appUnder(apiClient: apiClient, activeToken: activeToken, historyRepository: historyRepository));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    expect(find.byType(TokenDetailsScreen), findsOneWidget);
    expect(find.text('A002'), findsWidgets);
    expect(find.byType(TokenHistoryScreen), findsNothing);
  });

  testWidgets('a terminal token with no matching History entry falls back to the History list',
      (tester) async {
    final apiClient = ApiClient(
      httpClient: MockClient((_) async => ok(buildToken(id: 'token-a', status: 'COMPLETED').toJsonForTest())),
      baseUrl: 'http://localhost:4000',
    );
    final activeToken = ActiveTokenProvider(
      tokenRepository: TokenRepository(apiService: TokenApiService(apiClient), socketService: SocketService()),
      storage: ActiveTokenStorageService(),
    );
    final historyRepository = HistoryRepository(storageService: HistoryStorageService());
    // Deliberately empty — no entry recorded for this token id anywhere.

    await tester.pumpWidget(appUnder(apiClient: apiClient, activeToken: activeToken, historyRepository: historyRepository));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    expect(find.byType(TokenHistoryScreen), findsOneWidget);
    expect(find.byType(TokenDetailsScreen), findsNothing);
  });

  testWidgets('a still-remembered token that fails to resync (network error) retries instead of opening History',
      (tester) async {
    final apiClient = ApiClient(
      httpClient: MockClient((_) async => throw Exception('network down')),
      baseUrl: 'http://localhost:4000',
    );
    final activeToken = ActiveTokenProvider(
      tokenRepository: TokenRepository(apiService: TokenApiService(apiClient), socketService: SocketService()),
      storage: ActiveTokenStorageService(),
    );
    // Remembered locally, so resyncOne actually attempts the network call
    // (and fails) rather than short-circuiting to null immediately.
    await activeToken.remember(buildToken(id: 'token-a', status: 'CALLED'), queueName: 'Pharmacy');
    final historyRepository = HistoryRepository(storageService: HistoryStorageService());

    await tester.pumpWidget(appUnder(apiClient: apiClient, activeToken: activeToken, historyRepository: historyRepository));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    expect(find.text('Could not check this token just now. Please try again.'), findsOneWidget);
    expect(find.byType(TokenHistoryScreen), findsNothing);
    expect(find.byType(TokenDetailsScreen), findsNothing);
    expect(find.byType(LiveTrackingScreen), findsNothing);
  });
}

extension _TokenJsonForTest on LiveQueueToken {
  Map<String, dynamic> toJsonForTest() => {
        'id': id,
        'queueId': queueId,
        'serviceId': serviceId,
        'serialNumber': serialNumber,
        'status': status.name.toUpperCase() == 'INPROGRESS' ? 'IN_PROGRESS' : status.name.toUpperCase(),
        'formData': formData,
        'position': position,
        'estimatedWaitMinutes': estimatedWaitMinutes,
        'counter': null,
        'createdAt': createdAt.toIso8601String(),
        'calledAt': calledAt?.toIso8601String(),
        'startedAt': startedAt?.toIso8601String(),
        'completedAt': completedAt?.toIso8601String(),
        'skippedAt': skippedAt?.toIso8601String(),
      };
}
