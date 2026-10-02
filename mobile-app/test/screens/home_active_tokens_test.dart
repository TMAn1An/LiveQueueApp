// Home must be able to show more than one remembered token at once (V2
// Product Completion checkpoint, Part A) — the single "Active Token · A002"
// button is the pre-checkpoint UI, kept only for the one-token case; two or
// more get a short list, and tapping any row must resync and open that
// exact token, never whichever one happens to be first or most recent.

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/models/live_queue_token.dart';
import 'package:mobile_app/models/notification_preferences.dart';
import 'package:mobile_app/providers/active_token_provider.dart';
import 'package:mobile_app/providers/notification_center_provider.dart';
import 'package:mobile_app/services/notification_center_storage_service.dart';
import 'package:mobile_app/providers/notification_preferences_provider.dart';
import 'package:mobile_app/providers/queue_join_provider.dart';
import 'package:mobile_app/providers/token_tracking_provider.dart';
import 'package:mobile_app/repositories/device_repository.dart';
import 'package:mobile_app/repositories/email_verification_repository.dart';
import 'package:mobile_app/repositories/history_repository.dart';
import 'package:mobile_app/repositories/notification_preferences_repository.dart';
import 'package:mobile_app/repositories/queue_repository.dart';
import 'package:mobile_app/repositories/token_repository.dart';
import 'package:mobile_app/screens/home_screen.dart';
import 'package:mobile_app/screens/live_tracking_screen.dart';
import 'package:mobile_app/screens/token_confirmation_screen.dart';
import 'package:mobile_app/services/active_token_storage_service.dart';
import 'package:mobile_app/services/api_client.dart';
import 'package:mobile_app/services/device_api_service.dart';
import 'package:mobile_app/services/device_identity_service.dart';
import 'package:mobile_app/services/email_verification_api_service.dart';
import 'package:mobile_app/services/fcm_service.dart';
import 'package:mobile_app/services/history_storage_service.dart';
import 'package:mobile_app/services/notification_service.dart';
import 'package:mobile_app/services/preferences_storage_service.dart';
import 'package:mobile_app/services/queue_api_service.dart';
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

/// The real `start()` opens an actual socket_io_client connection, which
/// leaves a pending reconnect timer a widget test never lets finish. This
/// test is about which token gets opened, not about the live socket
/// session, so `start()` is overridden to do only the part that matters
/// here — record the token — exactly as tracking_navigation_test.dart's
/// `_StubTracking` does for the same reason.
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

Future<ActiveTokenProvider> _twoTokenProvider(ApiClient apiClient) async {
  final provider = ActiveTokenProvider(
    tokenRepository: TokenRepository(
      apiService: TokenApiService(apiClient),
      socketService: SocketService(),
    ),
    storage: ActiveTokenStorageService(),
  );
  await provider.remember(
    LiveQueueToken.fromJson(_tokenJson(id: 'token-a', queueId: 'queue-a', serial: 'A002')),
    queueName: 'Pharmacy',
  );
  await provider.remember(
    LiveQueueToken.fromJson(_tokenJson(id: 'token-b', queueId: 'queue-b', serial: 'B014')),
    queueName: 'Billing',
  );
  return provider;
}

Widget _appUnder(ApiClient apiClient, ActiveTokenProvider activeToken) {
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<NotificationCenterProvider>(
        create: (_) => NotificationCenterProvider(storage: NotificationCenterStorageService()),
      ),
      ChangeNotifierProvider<ActiveTokenProvider>.value(value: activeToken),
      ChangeNotifierProvider<TokenTrackingProvider>(
        create: (_) => _StubTracking(apiClient),
      ),
      ChangeNotifierProvider<NotificationPreferencesProvider>(
        create: (_) => NotificationPreferencesProvider(
          repository: NotificationPreferencesRepository(
            storageService: PreferencesStorageService(),
          ),
          notificationService: NotificationService(),
        ),
      ),
      ChangeNotifierProvider<QueueJoinProvider>(
        create: (_) => QueueJoinProvider(
          queueRepository: QueueRepository(apiService: QueueApiService(apiClient)),
          tokenRepository: TokenRepository(
            apiService: TokenApiService(apiClient),
            socketService: SocketService(),
          ),
          deviceRepository: DeviceRepository(
            identityService: DeviceIdentityService(),
            apiService: DeviceApiService(apiClient),
          ),
          historyRepository: HistoryRepository(storageService: HistoryStorageService()),
          emailVerificationRepository: EmailVerificationRepository(
            apiService: EmailVerificationApiService(apiClient),
          ),
        ),
      ),
    ],
    child: const MaterialApp(home: HomeScreen()),
  );
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('shows an "Active Tokens (2)" section rather than one button', (tester) async {
    final apiClient = ApiClient(
      httpClient: MockClient((_) async => _ok(_tokenJson(id: 'x', queueId: 'x', serial: 'x'))),
      baseUrl: 'http://localhost:4000',
    );
    final active = await _twoTokenProvider(apiClient);

    await tester.pumpWidget(_appUnder(apiClient, active));

    expect(find.text('Active Tokens (2)'), findsOneWidget);
    expect(find.textContaining('A002 · Pharmacy'), findsOneWidget);
    expect(find.textContaining('B014 · Billing'), findsOneWidget);
    // The pre-checkpoint single-button label must not appear for two tokens.
    expect(find.text('Active Token · A002'), findsNothing);
  });

  testWidgets('every active-token row is a filled button — visually primary, matching the single-token style',
      (tester) async {
    final apiClient = ApiClient(
      httpClient: MockClient((_) async => _ok(_tokenJson(id: 'x', queueId: 'x', serial: 'x'))),
      baseUrl: 'http://localhost:4000',
    );
    final active = await _twoTokenProvider(apiClient);

    await tester.pumpWidget(_appUnder(apiClient, active));

    expect(find.widgetWithText(FilledButton, 'A002 · Pharmacy'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'B014 · Billing'), findsOneWidget);
    // Scan QR/History/Settings stay outlined — active tokens alone are primary.
    expect(find.widgetWithText(OutlinedButton, 'Scan QR Code'), findsOneWidget);
  });

  testWidgets('tapping the second row opens live tracking for that token, not the first',
      (tester) async {
    final apiClient = ApiClient(
      httpClient: MockClient((request) async {
        if (request.url.path.contains('token-b')) {
          return _ok(_tokenJson(id: 'token-b', queueId: 'queue-b', serial: 'B014', status: 'CALLED'));
        }
        return _ok(_tokenJson(id: 'token-a', queueId: 'queue-a', serial: 'A002'));
      }),
      baseUrl: 'http://localhost:4000',
    );
    final active = await _twoTokenProvider(apiClient);

    await tester.pumpWidget(_appUnder(apiClient, active));
    await tester.tap(find.textContaining('B014 · Billing'));
    await tester.pumpAndSettle();

    expect(find.byType(LiveTrackingScreen), findsOneWidget);
    final tracking =
        tester.element(find.byType(LiveTrackingScreen)).read<TokenTrackingProvider>();
    expect(tracking.token?.id, 'token-b');
    expect(tracking.token?.status, TokenStatus.called);

    // Leaves the tracking screen before the test ends, so its own 1-second
    // repaint Timer is disposed rather than still pending at teardown —
    // unrelated to what this test verifies, but required for a clean exit.
    await tester.pageBack();
    await tester.pumpAndSettle();
  });

  testWidgets('a single remembered token keeps the pre-checkpoint single button', (tester) async {
    final apiClient = ApiClient(
      httpClient: MockClient(
        (_) async => _ok(_tokenJson(id: 'token-a', queueId: 'queue-a', serial: 'A002')),
      ),
      baseUrl: 'http://localhost:4000',
    );
    final active = ActiveTokenProvider(
      tokenRepository: TokenRepository(
        apiService: TokenApiService(apiClient),
        socketService: SocketService(),
      ),
      storage: ActiveTokenStorageService(),
    );
    await active.remember(
      LiveQueueToken.fromJson(_tokenJson(id: 'token-a', queueId: 'queue-a', serial: 'A002')),
      queueName: 'Pharmacy',
    );

    await tester.pumpWidget(_appUnder(apiClient, active));

    expect(find.text('Active Token · A002'), findsOneWidget);
    expect(find.textContaining('Active Tokens ('), findsNothing);
  });

  testWidgets('after joining, Back from Live Tracking goes Home — not back into the join screens',
      (tester) async {
    final apiClient = ApiClient(
      httpClient: MockClient(
        (_) async => _ok(_tokenJson(id: 'token-a', queueId: 'queue-a', serial: 'A002')),
      ),
      baseUrl: 'http://localhost:4000',
    );
    final active = ActiveTokenProvider(
      tokenRepository: TokenRepository(
        apiService: TokenApiService(apiClient),
        socketService: SocketService(),
      ),
      storage: ActiveTokenStorageService(),
    );
    await tester.pumpWidget(_appUnder(apiClient, active));
    final navigator = tester.state<NavigatorState>(find.byType(Navigator));
    final context = tester.element(find.byType(HomeScreen));

    // The join flow as it stands when the token has just been created: its
    // own screens are still on the stack beneath the confirmation.
    navigator.push(MaterialPageRoute<void>(builder: (_) => const Scaffold(body: Text('join step'))));
    Provider.of<QueueJoinProvider>(context, listen: false).createdToken =
        LiveQueueToken.fromJson(_tokenJson(id: 'token-a', queueId: 'queue-a', serial: 'A002'));
    navigator.push(MaterialPageRoute<void>(builder: (_) => const TokenConfirmationScreen()));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Track My Token'));
    await tester.pumpAndSettle();
    expect(find.byType(LiveTrackingScreen), findsOneWidget);

    await tester.pageBack();
    await tester.pumpAndSettle();

    expect(find.text('join step'), findsNothing);
    expect(find.byType(HomeScreen), findsOneWidget);
    expect(find.text('Active Token · A002'), findsOneWidget);
  });

  // Home is the bottom of the stack, so Android only hands a Back press to
  // the app if the app has said it will handle one. With the menu open it
  // has to say so — otherwise Back sends the whole app to the background
  // and leaves the drawer open behind it.
  group('Back with the navigation menu open', () {
    Future<List<bool>> frameworkHandlesBackCalls(WidgetTester tester, Future<void> Function() body) async {
      final calls = <bool>[];
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
        if (call.method == 'SystemNavigator.setFrameworkHandlesBack') {
          calls.add(call.arguments as bool);
        }
        return null;
      });
      addTearDown(
        () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null),
      );
      await body();
      return calls;
    }

    ApiClient client() => ApiClient(
          httpClient: MockClient((_) async => _ok(_tokenJson(id: 'x', queueId: 'x', serial: 'x'))),
          baseUrl: 'http://localhost:4000',
        );

    testWidgets('the app claims the Back press while the menu is open, and releases it after', (tester) async {
      final apiClient = client();
      final active = await _twoTokenProvider(apiClient);

      final calls = await frameworkHandlesBackCalls(tester, () async {
        await tester.pumpWidget(_appUnder(apiClient, active));
        // The framework only reports to the platform once the app is
        // running in the foreground, as it is on a phone.
        tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Open navigation menu'));
        await tester.pumpAndSettle();
      });
      expect(calls.last, isTrue, reason: 'Back must reach the app while the menu is open');

      final afterClose = await frameworkHandlesBackCalls(tester, () async {
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
      });
      expect(afterClose.last, isFalse, reason: 'with the menu closed, Back leaves the app as usual');
    });

    testWidgets('Back closes the menu and stays on Home', (tester) async {
      final apiClient = client();
      final active = await _twoTokenProvider(apiClient);
      await tester.pumpWidget(_appUnder(apiClient, active));
      await tester.pumpAndSettle();

      await tester.tap(find.byTooltip('Open navigation menu'));
      await tester.pumpAndSettle();
      expect(find.text('Scan / Join Queue'), findsOneWidget);

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();

      expect(find.text('Scan / Join Queue'), findsNothing);
      expect(find.byType(HomeScreen), findsOneWidget);
    });
  });
}
