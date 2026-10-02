import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
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
import 'package:mobile_app/widgets/reminder_caution.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// ADR-062: Live Tracking says which reminder time is in force and whose it
/// is, and warns when the turn is already closer than that. What decides
/// each of those is covered in token_tracking_reminder_test.dart; this is
/// only about what the screen shows for a given answer.
class _FakeTracking extends TokenTrackingProvider {
  _FakeTracking({
    required this.minutes,
    required this.followsQueueDefault,
    required this.leadTooShort,
    required TokenStatus status,
  }) : super(
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
        ) {
    token = LiveQueueToken(
      id: 'token-1',
      queueId: 'queue-1',
      serviceId: 'service-1',
      serialNumber: 'A007',
      status: status,
      formData: const {},
      position: 2,
      estimatedWaitMinutes: 3,
      estimatedReadyAt: DateTime.now().add(const Duration(minutes: 3)),
      counter: null,
      createdAt: DateTime.utc(2026, 1, 1),
    );
    isConnected = true;
  }

  final int minutes;
  final bool followsQueueDefault;
  final bool leadTooShort;

  @override
  int get reminderMinutes => minutes;
  @override
  bool get reminderFollowsQueueDefault => followsQueueDefault;
  @override
  bool get reminderLeadTooShort => leadTooShort;
}

Future<void> _pump(WidgetTester tester, _FakeTracking provider) async {
  tester.view.physicalSize = const Size(800, 2000);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ChangeNotifierProvider<TokenTrackingProvider>.value(
      value: provider,
      child: const MaterialApp(home: LiveTrackingScreen()),
    ),
  );
  await tester.pump();
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets("names the queue's default as such", (tester) async {
    await _pump(
      tester,
      _FakeTracking(minutes: 10, followsQueueDefault: true, leadTooShort: false, status: TokenStatus.waiting),
    );

    expect(find.text('Reminder'), findsOneWidget);
    expect(find.text('10 min before (queue default)'), findsOneWidget);
    expect(find.byType(ReminderCaution), findsNothing);
  });

  testWidgets("shows the customer's own time without that label", (tester) async {
    await _pump(
      tester,
      _FakeTracking(minutes: 37, followsQueueDefault: false, leadTooShort: false, status: TokenStatus.waiting),
    );

    expect(find.text('37 min before'), findsOneWidget);
  });

  testWidgets('warns when the turn is expected sooner than the reminder', (tester) async {
    await _pump(
      tester,
      _FakeTracking(minutes: 15, followsQueueDefault: false, leadTooShort: true, status: TokenStatus.waiting),
    );

    expect(find.byType(ReminderCaution), findsOneWidget);
    expect(
      find.textContaining('Your turn is expected sooner than your 15-minute reminder'),
      findsOneWidget,
    );
  });

  testWidgets('says nothing about reminders once the token has been called', (tester) async {
    await _pump(
      tester,
      _FakeTracking(minutes: 15, followsQueueDefault: false, leadTooShort: true, status: TokenStatus.called),
    );

    expect(find.text('Reminder'), findsNothing);
    expect(find.byType(ReminderCaution), findsNothing);
  });
}
