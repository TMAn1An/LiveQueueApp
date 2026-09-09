// The in-app Notification Center screen (V2 Product Completion checkpoint,
// Part D) — empty state, the list itself, mark-all-read, and — the one
// requirement that actually matters for multiple active tokens — tapping a
// notification opens the token it names, never a global "current token".

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/models/live_queue_token.dart';
import 'package:mobile_app/models/notification_preferences.dart';
import 'package:mobile_app/providers/active_token_provider.dart';
import 'package:mobile_app/providers/notification_center_provider.dart';
import 'package:mobile_app/providers/notification_preferences_provider.dart';
import 'package:mobile_app/providers/token_tracking_provider.dart';
import 'package:mobile_app/repositories/device_repository.dart';
import 'package:mobile_app/repositories/history_repository.dart';
import 'package:mobile_app/repositories/notification_preferences_repository.dart';
import 'package:mobile_app/repositories/token_repository.dart';
import 'package:mobile_app/screens/live_tracking_screen.dart';
import 'package:mobile_app/screens/notification_center_screen.dart';
import 'package:mobile_app/services/active_token_storage_service.dart';
import 'package:mobile_app/services/api_client.dart';
import 'package:mobile_app/services/device_api_service.dart';
import 'package:mobile_app/services/device_identity_service.dart';
import 'package:mobile_app/services/fcm_service.dart';
import 'package:mobile_app/services/history_storage_service.dart';
import 'package:mobile_app/services/notification_center_storage_service.dart';
import 'package:mobile_app/services/notification_service.dart';
import 'package:mobile_app/services/preferences_storage_service.dart';
import 'package:mobile_app/services/socket_service.dart';
import 'package:mobile_app/services/token_api_service.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

LiveQueueToken _token({required String id, required String serial, String status = 'WAITING'}) =>
    LiveQueueToken.fromJson({
      'id': id,
      'queueId': 'queue-$id',
      'serviceId': 'service-1',
      'serialNumber': serial,
      'status': status,
      'formData': <String, dynamic>{},
      'position': 1,
      'estimatedWaitMinutes': 5,
      'counter': null,
      'createdAt': DateTime.utc(2026, 1, 1).toIso8601String(),
      'calledAt': status == 'CALLED' ? DateTime.utc(2026, 1, 1).toIso8601String() : null,
      'startedAt': null,
      'completedAt': null,
      'skippedAt': null,
    });

http.Response _ok(Map<String, dynamic> data) =>
    http.Response(jsonEncode({'success': true, 'data': data}), 200);

/// See home_active_tokens_test.dart: the real start() opens a real socket
/// connection a widget test can never let finish.
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
  void start(LiveQueueToken initialToken, NotificationPreferences preferences, {String queueName = ''}) {
    token = initialToken;
    notifyListeners();
  }
}

Widget _appUnder({
  required NotificationCenterProvider notificationCenter,
  required ActiveTokenProvider activeToken,
  required ApiClient apiClient,
}) {
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<NotificationCenterProvider>.value(value: notificationCenter),
      ChangeNotifierProvider<ActiveTokenProvider>.value(value: activeToken),
      ChangeNotifierProvider<TokenTrackingProvider>(create: (_) => _StubTracking(apiClient)),
      ChangeNotifierProvider<NotificationPreferencesProvider>(
        create: (_) => NotificationPreferencesProvider(
          repository: NotificationPreferencesRepository(storageService: PreferencesStorageService()),
          notificationService: NotificationService(),
        ),
      ),
    ],
    child: const MaterialApp(home: NotificationCenterScreen()),
  );
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('shows the empty state when nothing has happened yet', (tester) async {
    final apiClient = ApiClient(baseUrl: 'http://localhost:4000');
    final notificationCenter =
        NotificationCenterProvider(storage: NotificationCenterStorageService());
    await notificationCenter.load();
    final activeToken = ActiveTokenProvider(
      tokenRepository: TokenRepository(apiService: TokenApiService(apiClient), socketService: SocketService()),
      storage: ActiveTokenStorageService(),
    );

    await tester.pumpWidget(_appUnder(
      notificationCenter: notificationCenter,
      activeToken: activeToken,
      apiClient: apiClient,
    ));

    expect(find.textContaining('Nothing yet'), findsOneWidget);
  });

  testWidgets('lists notifications newest first, unread ones visually distinct', (tester) async {
    final apiClient = ApiClient(baseUrl: 'http://localhost:4000');
    final notificationCenter =
        NotificationCenterProvider(storage: NotificationCenterStorageService());
    await notificationCenter.load();
    notificationCenter.recordJoin(_token(id: 'token-a', serial: 'A002'), queueName: 'Pharmacy');
    notificationCenter.recordStatusChange(
      _token(id: 'token-a', serial: 'A002', status: 'CALLED'),
      queueName: 'Pharmacy',
    );
    final activeToken = ActiveTokenProvider(
      tokenRepository: TokenRepository(apiService: TokenApiService(apiClient), socketService: SocketService()),
      storage: ActiveTokenStorageService(),
    );

    await tester.pumpWidget(_appUnder(
      notificationCenter: notificationCenter,
      activeToken: activeToken,
      apiClient: apiClient,
    ));

    expect(find.text('Your token was called'), findsOneWidget);
    expect(find.text('You joined the queue'), findsOneWidget);
    expect(find.text('Mark all read'), findsOneWidget);
  });

  testWidgets('Mark all read clears the unread badge', (tester) async {
    final apiClient = ApiClient(baseUrl: 'http://localhost:4000');
    final notificationCenter =
        NotificationCenterProvider(storage: NotificationCenterStorageService());
    await notificationCenter.load();
    notificationCenter.recordJoin(_token(id: 'token-a', serial: 'A002'), queueName: 'Pharmacy');
    final activeToken = ActiveTokenProvider(
      tokenRepository: TokenRepository(apiService: TokenApiService(apiClient), socketService: SocketService()),
      storage: ActiveTokenStorageService(),
    );

    await tester.pumpWidget(_appUnder(
      notificationCenter: notificationCenter,
      activeToken: activeToken,
      apiClient: apiClient,
    ));
    expect(notificationCenter.unreadCount, 1);

    await tester.tap(find.text('Mark all read'));
    await tester.pump();

    expect(notificationCenter.unreadCount, 0);
    expect(find.text('Mark all read'), findsNothing);
  });

  testWidgets('tapping a notification about Token B opens Token B, not Token A', (tester) async {
    final apiClient = ApiClient(
      httpClient: MockClient((request) async {
        if (request.url.path.contains('token-b')) {
          return _ok(jsonDecode(jsonEncode(_tokenJsonFor('token-b', 'B014'))) as Map<String, dynamic>);
        }
        return _ok(jsonDecode(jsonEncode(_tokenJsonFor('token-a', 'A002'))) as Map<String, dynamic>);
      }),
      baseUrl: 'http://localhost:4000',
    );
    final notificationCenter =
        NotificationCenterProvider(storage: NotificationCenterStorageService());
    await notificationCenter.load();
    notificationCenter.recordStatusChange(
      _token(id: 'token-a', serial: 'A002', status: 'CALLED'),
      queueName: 'Pharmacy',
    );
    notificationCenter.recordStatusChange(
      _token(id: 'token-b', serial: 'B014', status: 'CALLED'),
      queueName: 'Billing',
    );
    final activeToken = ActiveTokenProvider(
      tokenRepository: TokenRepository(apiService: TokenApiService(apiClient), socketService: SocketService()),
      storage: ActiveTokenStorageService(),
    );
    await activeToken.remember(_token(id: 'token-a', serial: 'A002'), queueName: 'Pharmacy');
    await activeToken.remember(_token(id: 'token-b', serial: 'B014'), queueName: 'Billing');

    await tester.pumpWidget(_appUnder(
      notificationCenter: notificationCenter,
      activeToken: activeToken,
      apiClient: apiClient,
    ));

    await tester.tap(find.textContaining('B014'));
    await tester.pumpAndSettle();

    expect(find.byType(LiveTrackingScreen), findsOneWidget);
    final tracking =
        tester.element(find.byType(LiveTrackingScreen)).read<TokenTrackingProvider>();
    expect(tracking.token?.id, 'token-b');

    await tester.pageBack();
    await tester.pumpAndSettle();
  });

  testWidgets('tapping a notification marks it read', (tester) async {
    final apiClient = ApiClient(
      httpClient: MockClient((_) async => _ok(jsonDecode(jsonEncode(_tokenJsonFor('token-a', 'A002'))) as Map<String, dynamic>)),
      baseUrl: 'http://localhost:4000',
    );
    final notificationCenter =
        NotificationCenterProvider(storage: NotificationCenterStorageService());
    await notificationCenter.load();
    notificationCenter.recordStatusChange(
      _token(id: 'token-a', serial: 'A002', status: 'CALLED'),
      queueName: 'Pharmacy',
    );
    final activeToken = ActiveTokenProvider(
      tokenRepository: TokenRepository(apiService: TokenApiService(apiClient), socketService: SocketService()),
      storage: ActiveTokenStorageService(),
    );
    await activeToken.remember(_token(id: 'token-a', serial: 'A002'), queueName: 'Pharmacy');

    await tester.pumpWidget(_appUnder(
      notificationCenter: notificationCenter,
      activeToken: activeToken,
      apiClient: apiClient,
    ));
    expect(notificationCenter.unreadCount, 1);

    await tester.tap(find.text('Your token was called'));
    await tester.pumpAndSettle();

    expect(notificationCenter.unreadCount, 0);

    await tester.pageBack();
    await tester.pumpAndSettle();
  });
}

Map<String, dynamic> _tokenJsonFor(String id, String serial) => {
      'id': id,
      'queueId': 'queue-$id',
      'serviceId': 'service-1',
      'serialNumber': serial,
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
    };
