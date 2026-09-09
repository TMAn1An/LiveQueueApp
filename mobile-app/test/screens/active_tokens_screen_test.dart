// The Active Tokens list screen (V2 Product Completion checkpoint, Part A) —
// reachable from the drawer, resyncs every remembered token before showing
// anything, and opens the right one on tap.

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/models/live_queue_token.dart';
import 'package:mobile_app/models/notification_preferences.dart';
import 'package:mobile_app/providers/active_token_provider.dart';
import 'package:mobile_app/providers/notification_preferences_provider.dart';
import 'package:mobile_app/providers/token_tracking_provider.dart';
import 'package:mobile_app/repositories/device_repository.dart';
import 'package:mobile_app/repositories/history_repository.dart';
import 'package:mobile_app/repositories/notification_preferences_repository.dart';
import 'package:mobile_app/repositories/token_repository.dart';
import 'package:mobile_app/screens/active_tokens_screen.dart';
import 'package:mobile_app/screens/live_tracking_screen.dart';
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
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

Map<String, dynamic> _tokenJson({
  required String id,
  required String queueId,
  required String serial,
  String status = 'WAITING',
}) =>
    {
      'id': id,
      'queueId': queueId,
      'serviceId': 'service-1',
      'serialNumber': serial,
      'status': status,
      'formData': <String, dynamic>{},
      'position': 1,
      'estimatedWaitMinutes': 5,
      'counter': null,
      'createdAt': DateTime.utc(2026, 9, 9).toIso8601String(),
      'calledAt': null,
      'startedAt': null,
      'completedAt': null,
      'skippedAt': null,
    };

http.Response _ok(Map<String, dynamic> data) =>
    http.Response(jsonEncode({'success': true, 'data': data}), 200);
http.Response _err(int status, String code) => http.Response(
      jsonEncode({
        'success': false,
        'error': {'code': code, 'message': 'nope'},
      }),
      status,
    );

/// See home_active_tokens_test.dart: the real start() opens a real socket
/// connection this widget-test environment can never let finish.
class _StubTracking extends TokenTrackingProvider {
  _StubTracking(ApiClient client)
      : super(
          tokenRepository: TokenRepository(
            apiService: TokenApiService(client),
            socketService: SocketService(),
          ),
          deviceRepository: DeviceRepository(
            identityService: DeviceIdentityService(),
            apiService: DeviceApiService(client),
          ),
          historyRepository: HistoryRepository(storageService: HistoryStorageService()),
          notificationService: NotificationService(),
          fcmService: FcmService(notificationService: NotificationService()),
        );

  @override
  void start(LiveQueueToken initialToken, NotificationPreferences preferences) {
    token = initialToken;
    notifyListeners();
  }
}

Widget _appUnder(ApiClient apiClient, ActiveTokenProvider activeToken) {
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<ActiveTokenProvider>.value(value: activeToken),
      ChangeNotifierProvider<TokenTrackingProvider>(create: (_) => _StubTracking(apiClient)),
      ChangeNotifierProvider<NotificationPreferencesProvider>(
        create: (_) => NotificationPreferencesProvider(
          repository: NotificationPreferencesRepository(
            storageService: PreferencesStorageService(),
          ),
          notificationService: NotificationService(),
        ),
      ),
    ],
    child: const MaterialApp(home: ActiveTokensScreen()),
  );
}

ActiveTokenProvider _provider(ApiClient apiClient) => ActiveTokenProvider(
      tokenRepository: TokenRepository(
        apiService: TokenApiService(apiClient),
        socketService: SocketService(),
      ),
      storage: ActiveTokenStorageService(),
    );

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('shows the empty state when nothing is remembered', (tester) async {
    final apiClient = ApiClient(baseUrl: 'http://localhost:4000');
    await tester.pumpWidget(_appUnder(apiClient, _provider(apiClient)));
    await tester.pumpAndSettle();

    expect(find.text('You are not currently in any queue.'), findsOneWidget);
  });

  testWidgets('lists every remembered token with its resynced status', (tester) async {
    final apiClient = ApiClient(
      httpClient: MockClient((request) async {
        if (request.url.path.contains('token-a')) {
          return _ok(_tokenJson(id: 'token-a', queueId: 'queue-a', serial: 'A002', status: 'WAITING'));
        }
        return _ok(_tokenJson(id: 'token-b', queueId: 'queue-b', serial: 'B014', status: 'CALLED'));
      }),
      baseUrl: 'http://localhost:4000',
    );
    final active = _provider(apiClient);
    await active.remember(
      LiveQueueToken.fromJson(_tokenJson(id: 'token-a', queueId: 'queue-a', serial: 'A002')),
      queueName: 'Pharmacy',
    );
    await active.remember(
      LiveQueueToken.fromJson(_tokenJson(id: 'token-b', queueId: 'queue-b', serial: 'B014')),
      queueName: 'Billing',
    );

    await tester.pumpWidget(_appUnder(apiClient, active));
    await tester.pumpAndSettle();

    expect(find.text('A002'), findsOneWidget);
    expect(find.textContaining('Pharmacy'), findsOneWidget);
    expect(find.text('B014'), findsOneWidget);
    expect(find.textContaining('Called'), findsOneWidget);
  });

  testWidgets('a stale token that 404s is dropped, its sibling remains', (tester) async {
    final apiClient = ApiClient(
      httpClient: MockClient((request) async {
        if (request.url.path.contains('token-a')) {
          return _err(404, 'TOKEN_NOT_FOUND');
        }
        return _ok(_tokenJson(id: 'token-b', queueId: 'queue-b', serial: 'B014'));
      }),
      baseUrl: 'http://localhost:4000',
    );
    final active = _provider(apiClient);
    await active.remember(
      LiveQueueToken.fromJson(_tokenJson(id: 'token-a', queueId: 'queue-a', serial: 'A002')),
      queueName: 'Pharmacy',
    );
    await active.remember(
      LiveQueueToken.fromJson(_tokenJson(id: 'token-b', queueId: 'queue-b', serial: 'B014')),
      queueName: 'Billing',
    );

    await tester.pumpWidget(_appUnder(apiClient, active));
    await tester.pumpAndSettle();

    expect(find.text('A002'), findsNothing);
    expect(find.text('B014'), findsOneWidget);
  });

  testWidgets('tapping a row opens Live Tracking for that exact token', (tester) async {
    final apiClient = ApiClient(
      httpClient: MockClient(
        (_) async => _ok(_tokenJson(id: 'token-a', queueId: 'queue-a', serial: 'A002')),
      ),
      baseUrl: 'http://localhost:4000',
    );
    final active = _provider(apiClient);
    await active.remember(
      LiveQueueToken.fromJson(_tokenJson(id: 'token-a', queueId: 'queue-a', serial: 'A002')),
      queueName: 'Pharmacy',
    );

    await tester.pumpWidget(_appUnder(apiClient, active));
    await tester.pumpAndSettle();

    await tester.tap(find.text('A002'));
    await tester.pumpAndSettle();

    expect(find.byType(LiveTrackingScreen), findsOneWidget);

    // Dispose LiveTrackingScreen's repaint timer before the test ends.
    await tester.pageBack();
    await tester.pumpAndSettle();
  });
}
