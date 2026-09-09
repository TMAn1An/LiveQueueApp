import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/models/live_queue_token.dart';
import 'package:mobile_app/providers/active_token_provider.dart';
import 'package:mobile_app/providers/queue_join_provider.dart';
import 'package:mobile_app/repositories/device_repository.dart';
import 'package:mobile_app/repositories/history_repository.dart';
import 'package:mobile_app/repositories/email_verification_repository.dart';
import 'package:mobile_app/repositories/queue_repository.dart';
import 'package:mobile_app/repositories/token_repository.dart';
import 'package:mobile_app/services/active_token_storage_service.dart';
import 'package:mobile_app/services/api_client.dart';
import 'package:mobile_app/services/device_api_service.dart';
import 'package:mobile_app/services/device_identity_service.dart';
import 'package:mobile_app/services/history_storage_service.dart';
import 'package:mobile_app/services/email_verification_api_service.dart';
import 'package:mobile_app/services/queue_api_service.dart';
import 'package:mobile_app/services/socket_service.dart';
import 'package:mobile_app/services/token_api_service.dart';
import 'package:mobile_app/widgets/app_drawer.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The menu exists so a customer can move around the app without abandoning
/// their place in a queue (ADR-036).

LiveQueueToken _token({String id = 'token-1', String queueId = 'queue-1', String serial = 'A023'}) =>
    LiveQueueToken.fromJson({
      'id': id,
      'queueId': queueId,
      'serviceId': 'service-1',
      'serialNumber': serial,
      'status': 'WAITING',
      'formData': <String, dynamic>{},
      'position': 3,
      'estimatedWaitMinutes': 12,
      'counter': null,
      'createdAt': DateTime.utc(2026, 9, 9).toIso8601String(),
      'calledAt': null,
      'startedAt': null,
      'completedAt': null,
      'skippedAt': null,
    });

Future<void> _pumpDrawer(WidgetTester tester, ActiveTokenProvider active) async {
  final apiClient = ApiClient(baseUrl: 'http://localhost:4000');
  await tester.pumpWidget(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<ActiveTokenProvider>.value(value: active),
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
      child: const MaterialApp(
        home: Scaffold(drawer: AppDrawer(), body: SizedBox.shrink()),
      ),
    ),
  );
  // Open the drawer the way a customer would.
  tester.state<ScaffoldState>(find.byType(Scaffold)).openDrawer();
  await tester.pumpAndSettle();
}

ActiveTokenProvider _provider() => ActiveTokenProvider(
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

  testWidgets('always offers Home, Scan and History', (tester) async {
    await _pumpDrawer(tester, _provider());

    expect(find.text('Home'), findsOneWidget);
    expect(find.text('Scan / Join Queue'), findsOneWidget);
    // History is reachable whether or not a token is running: a finished
    // visit and a running one are separate records.
    expect(find.text('History'), findsOneWidget);
  });

  testWidgets('hides Active Token when there is nothing to return to', (tester) async {
    await _pumpDrawer(tester, _provider());

    expect(find.text('Active Token'), findsNothing);
  });

  testWidgets('shows the running token, named so it is recognisable', (tester) async {
    final active = _provider();
    await active.remember(_token(), queueName: 'Pharmacy');

    await _pumpDrawer(tester, active);

    expect(find.text('Active Token'), findsOneWidget);
    expect(find.text('A023 · Pharmacy'), findsOneWidget);
    // History has not gone anywhere just because a token is live.
    expect(find.text('History'), findsOneWidget);
  });

  testWidgets('drops the entry once the visit is finished', (tester) async {
    final active = _provider();
    await active.remember(_token(), queueName: 'Pharmacy');
    await _pumpDrawer(tester, active);
    expect(find.text('Active Token'), findsOneWidget);

    await active.remove('token-1');
    await tester.pumpAndSettle();

    expect(find.text('Active Token'), findsNothing);
    expect(find.text('History'), findsOneWidget);
  });

  testWidgets('two remembered tokens collapse the label to a count', (tester) async {
    final active = _provider();
    await active.remember(_token(id: 'token-a', queueId: 'queue-a', serial: 'A023'),
        queueName: 'Pharmacy');
    await active.remember(_token(id: 'token-b', queueId: 'queue-b', serial: 'B014'),
        queueName: 'Billing');

    await _pumpDrawer(tester, active);

    expect(find.text('Active Tokens · 2'), findsOneWidget);
    // Two tokens named different things — no single subtitle line could
    // represent both, so unlike the single-token case there is no subtitle.
    expect(find.text('A023 · Pharmacy'), findsNothing);
  });

  testWidgets('removing one of two remembered tokens falls back to the singular label',
      (tester) async {
    final active = _provider();
    await active.remember(_token(id: 'token-a', queueId: 'queue-a', serial: 'A023'),
        queueName: 'Pharmacy');
    await active.remember(_token(id: 'token-b', queueId: 'queue-b', serial: 'B014'),
        queueName: 'Billing');
    await _pumpDrawer(tester, active);

    await active.remove('token-b');
    await tester.pumpAndSettle();

    expect(find.text('Active Token'), findsOneWidget);
    expect(find.text('A023 · Pharmacy'), findsOneWidget);
  });
}
