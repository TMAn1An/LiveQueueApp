import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/models/live_queue_token.dart';
import 'package:mobile_app/providers/active_token_provider.dart';
import 'package:mobile_app/providers/notification_preferences_provider.dart';
import 'package:mobile_app/providers/queue_join_provider.dart';
import 'package:mobile_app/providers/token_tracking_provider.dart';
import 'package:mobile_app/repositories/device_repository.dart';
import 'package:mobile_app/repositories/history_repository.dart';
import 'package:mobile_app/repositories/notification_preferences_repository.dart';
import 'package:mobile_app/repositories/email_verification_repository.dart';
import 'package:mobile_app/repositories/queue_repository.dart';
import 'package:mobile_app/repositories/token_repository.dart';
import 'package:mobile_app/screens/live_tracking_screen.dart';
import 'package:mobile_app/services/active_token_storage_service.dart';
import 'package:mobile_app/services/api_client.dart';
import 'package:mobile_app/services/device_api_service.dart';
import 'package:mobile_app/services/device_identity_service.dart';
import 'package:mobile_app/services/fcm_service.dart';
import 'package:mobile_app/services/history_storage_service.dart';
import 'package:mobile_app/services/notification_service.dart';
import 'package:mobile_app/services/email_verification_api_service.dart';
import 'package:mobile_app/services/preferences_storage_service.dart';
import 'package:mobile_app/services/queue_api_service.dart';
import 'package:mobile_app/services/socket_service.dart';
import 'package:mobile_app/services/token_api_service.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Leaving the tracking screen is navigation, not cancellation (ADR-036).

LiveQueueToken _token() => LiveQueueToken.fromJson({
      'id': 'token-1',
      'queueId': 'queue-1',
      'serviceId': 'service-1',
      'serialNumber': 'A023',
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

/// The tracking provider with its live session stubbed out — this test is
/// about navigation, not about sockets.
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

  bool stopped = false;

  void showToken(LiveQueueToken value) {
    token = value;
    notifyListeners();
  }

  @override
  void stop() {
    stopped = true;
    token = null;
  }
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  Future<(_StubTracking, ActiveTokenProvider)> pump(WidgetTester tester) async {
    final client = ApiClient(baseUrl: 'http://localhost:4000');
    final tracking = _StubTracking(client)..showToken(_token());
    final active = ActiveTokenProvider(
      tokenRepository: TokenRepository(
        apiService: TokenApiService(client),
        socketService: SocketService(),
      ),
      storage: ActiveTokenStorageService(),
    );
    await active.remember(_token(), queueName: 'Pharmacy');

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<TokenTrackingProvider>.value(value: tracking),
          ChangeNotifierProvider<ActiveTokenProvider>.value(value: active),
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
              queueRepository: QueueRepository(apiService: QueueApiService(client)),
              tokenRepository: TokenRepository(
                apiService: TokenApiService(client),
                socketService: SocketService(),
              ),
              deviceRepository: DeviceRepository(
                identityService: DeviceIdentityService(),
                apiService: DeviceApiService(client),
              ),
              historyRepository: HistoryRepository(storageService: HistoryStorageService()),
              emailVerificationRepository: EmailVerificationRepository(
                apiService: EmailVerificationApiService(client),
              ),
            ),
          ),
        ],
        child: MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: Center(
                child: ElevatedButton(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const LiveTrackingScreen()),
                  ),
                  child: const Text('open'),
                ),
              ),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    return (tracking, active);
  }

  testWidgets('offers a way back out of the tracking screen', (tester) async {
    await pump(tester);

    // A real Back affordance: before ADR-036 the app bar suppressed it and
    // the customer was stuck on this screen.
    expect(find.byType(BackButton), findsOneWidget);
  });

  testWidgets('going back keeps the token — it only ends the live session', (tester) async {
    final (tracking, active) = await pump(tester);

    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();

    expect(tracking.stopped, isTrue);
    // The customer is still in the queue, and the app still knows how to
    // take them back to it.
    expect(active.hasActiveToken, isTrue);
    expect(active.activeToken!.serialNumber, 'A023');
  });

  testWidgets('the Android system back does the same thing', (tester) async {
    final (_, active) = await pump(tester);

    // Simulates the hardware/gesture back, which is a separate path from the
    // app bar button and used to be the one that silently lost the token.
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();

    expect(active.hasActiveToken, isTrue);
  });

  testWidgets('keeps Back rather than a menu, so the way out stays obvious', (tester) async {
    await pump(tester);

    // A drawer would occupy the app bar's leading slot and hide Back — on a
    // pushed detail screen that is the wrong trade. The menu lives on the
    // top-level screens this returns to.
    expect(find.byTooltip('Open navigation menu'), findsNothing);
    expect(find.byType(BackButton), findsOneWidget);
  });
}
