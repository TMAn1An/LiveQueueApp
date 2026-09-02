import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/models/counter_info.dart';
import 'package:mobile_app/models/live_queue_token.dart';
import 'package:mobile_app/providers/token_tracking_provider.dart';
import 'package:mobile_app/repositories/device_repository.dart';
import 'package:mobile_app/repositories/history_repository.dart';
import 'package:mobile_app/repositories/token_repository.dart';
import 'package:mobile_app/screens/live_tracking_screen.dart';
import 'package:mobile_app/services/api_client.dart';
import 'package:mobile_app/services/device_api_service.dart';
import 'package:mobile_app/services/device_identity_service.dart';
import 'package:mobile_app/services/fcm_service.dart';
import 'package:mobile_app/services/history_storage_service.dart';
import 'package:mobile_app/services/notification_service.dart';
import 'package:mobile_app/services/socket_service.dart';
import 'package:mobile_app/services/token_api_service.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// A test double that can push state directly into the provider without
/// going through the real Socket.io connection this screen would normally
/// drive via .start() — this test is about the screen's rendering logic,
/// not the live-update wiring (covered separately by the realtime-facing
/// unit tests and by the backend's own Phase 4 test suite).
class _FakeTokenTrackingProvider extends TokenTrackingProvider {
  _FakeTokenTrackingProvider()
      : super(
          tokenRepository: TokenRepository(
            apiService: TokenApiService(ApiClient(baseUrl: 'http://localhost:4000')),
            socketService: SocketService(),
          ),
          deviceRepository: DeviceRepository(
            identityService: DeviceIdentityService(),
            apiService: DeviceApiService(ApiClient(baseUrl: 'http://localhost:4000')),
          ),
          historyRepository: HistoryRepository(storageService: HistoryStorageService()),
          notificationService: NotificationService(),
          fcmService: FcmService(notificationService: NotificationService()),
        );

  void pushState({
    required LiveQueueToken token,
    bool isConnected = true,
    bool isResyncing = false,
    bool queuePausedNotice = false,
    String? verificationCode,
    DateTime? verificationCodeExpiresAt,
  }) {
    this.token = token;
    this.isConnected = isConnected;
    this.isResyncing = isResyncing;
    this.queuePausedNotice = queuePausedNotice;
    this.verificationCode = verificationCode;
    this.verificationCodeExpiresAt = verificationCodeExpiresAt;
    notifyListeners();
  }
}

LiveQueueToken _token({
  required TokenStatus status,
  int? position,
  int? estimatedWaitMinutes,
  DateTime? estimatedReadyAt,
  CounterInfo? counter,
}) {
  return LiveQueueToken(
    id: 'token-1',
    queueId: 'queue-1',
    serviceId: 'service-1',
    serialNumber: 'A007',
    status: status,
    formData: const {},
    position: position,
    estimatedWaitMinutes: estimatedWaitMinutes,
    estimatedReadyAt: estimatedReadyAt,
    counter: counter,
    createdAt: DateTime.utc(2026, 1, 1),
  );
}

Future<void> _pump(WidgetTester tester, _FakeTokenTrackingProvider provider) {
  return tester.pumpWidget(
    ChangeNotifierProvider<TokenTrackingProvider>.value(
      value: provider,
      child: const MaterialApp(home: LiveTrackingScreen()),
    ),
  );
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('shows serial number, status, position, and a live countdown while WAITING', (tester) async {
    final provider = _FakeTokenTrackingProvider();
    provider.pushState(
      token: _token(
        status: TokenStatus.waiting,
        position: 4,
        estimatedWaitMinutes: 18,
        estimatedReadyAt: DateTime.now().add(const Duration(minutes: 18)),
      ),
    );
    await _pump(tester, provider);

    expect(find.text('A007'), findsOneWidget);
    expect(find.text('Waiting'), findsOneWidget);
    expect(find.text('4'), findsOneWidget);
    // V2 Checkpoint 4: a live mm:ss countdown, not a static "N minutes"
    // string — match the shape rather than an exact value, since real time
    // elapses between building `estimatedReadyAt` above and this assertion.
    expect(
      find.byWidgetPredicate(
        (widget) => widget is Text && RegExp(r'^\d{1,2}:\d{2}$').hasMatch(widget.data ?? ''),
      ),
      findsOneWidget,
    );
  });

  testWidgets('shows "Not available" when no estimate exists yet (e.g. zero active counters)', (tester) async {
    final provider = _FakeTokenTrackingProvider();
    provider.pushState(
      token: _token(status: TokenStatus.waiting, position: 1, estimatedWaitMinutes: null),
    );
    await _pump(tester, provider);

    expect(find.text('Not available'), findsOneWidget);
  });

  testWidgets('shows the counter name and turn banner when CALLED', (tester) async {
    final provider = _FakeTokenTrackingProvider();
    provider.pushState(
      token: _token(status: TokenStatus.called, counter: const CounterInfo(id: 'c1', name: 'Counter 2')),
    );
    await _pump(tester, provider);

    expect(find.text('Your Turn'), findsOneWidget);
    expect(find.text('Counter 2'), findsOneWidget);
    expect(find.text("It's your turn — please proceed."), findsOneWidget);
  });

  testWidgets('shows a paused notice when queuePausedNotice is true', (tester) async {
    final provider = _FakeTokenTrackingProvider();
    provider.pushState(token: _token(status: TokenStatus.waiting), queuePausedNotice: true);
    await _pump(tester, provider);

    expect(find.text('This queue has been paused by staff.'), findsOneWidget);
  });

  testWidgets('shows a "Back to Home" action once the token reaches a terminal state', (tester) async {
    final provider = _FakeTokenTrackingProvider();
    provider.pushState(token: _token(status: TokenStatus.completed));
    await _pump(tester, provider);

    expect(find.text('This token has been completed.'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Back to Home'), findsOneWidget);
  });

  testWidgets('shows "Reconnecting…" via the connection indicator when disconnected', (tester) async {
    final provider = _FakeTokenTrackingProvider();
    provider.pushState(token: _token(status: TokenStatus.waiting), isConnected: false);
    await _pump(tester, provider);

    expect(find.text('Reconnecting…'), findsOneWidget);
  });

  group('V2 Checkpoint 7 — cancellation and service-start verification code', () {
    testWidgets('WAITING and CALLED show a Leave Queue action; IN_PROGRESS and terminal states do not', (tester) async {
      for (final status in [TokenStatus.waiting, TokenStatus.called]) {
        final provider = _FakeTokenTrackingProvider();
        provider.pushState(token: _token(status: status));
        await _pump(tester, provider);
        expect(find.text('Leave Queue'), findsOneWidget, reason: 'for $status');
      }

      for (final status in [TokenStatus.inProgress, TokenStatus.completed, TokenStatus.cancelled]) {
        final provider = _FakeTokenTrackingProvider();
        provider.pushState(token: _token(status: status));
        await _pump(tester, provider);
        expect(find.text('Leave Queue'), findsNothing, reason: 'for $status');
      }
    });

    testWidgets('a CALLED token with a loaded code shows it prominently, with the tell-staff instruction', (tester) async {
      final provider = _FakeTokenTrackingProvider();
      provider.pushState(
        token: _token(status: TokenStatus.called),
        verificationCode: '482731',
        verificationCodeExpiresAt: DateTime.now().add(const Duration(minutes: 5)),
      );
      await _pump(tester, provider);

      expect(find.text('482731'), findsOneWidget);
      expect(
        find.text('Tell this code to the staff member to start your service.'),
        findsOneWidget,
      );
    });

    testWidgets('an expired code shows a renewal prompt instead of the stale code', (tester) async {
      final provider = _FakeTokenTrackingProvider();
      provider.pushState(
        token: _token(status: TokenStatus.called),
        verificationCode: '482731',
        verificationCodeExpiresAt: DateTime.now().subtract(const Duration(minutes: 1)),
      );
      await _pump(tester, provider);

      expect(find.text('482731'), findsNothing);
      expect(find.text('Your verification code has expired.'), findsOneWidget);
      expect(find.text('Get a new code'), findsOneWidget);
    });

    testWidgets('a CANCELLED token shows its own message, not the SKIPPED one', (tester) async {
      final provider = _FakeTokenTrackingProvider();
      provider.pushState(token: _token(status: TokenStatus.cancelled));
      await _pump(tester, provider);

      expect(find.text('You cancelled this token.'), findsOneWidget);
      expect(find.text('This token was skipped.'), findsNothing);
    });
  });
}
