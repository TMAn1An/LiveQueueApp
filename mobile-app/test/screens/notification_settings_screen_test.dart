import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/models/live_queue_token.dart';
import 'package:mobile_app/models/notification_preferences.dart';
import 'package:mobile_app/models/token_reminder_status.dart';
import 'package:mobile_app/providers/active_token_provider.dart';
import 'package:mobile_app/providers/notification_preferences_provider.dart';
import 'package:mobile_app/repositories/notification_preferences_repository.dart';
import 'package:mobile_app/repositories/token_repository.dart';
import 'package:mobile_app/screens/notification_settings_screen.dart';
import 'package:mobile_app/services/active_token_storage_service.dart';
import 'package:mobile_app/services/api_client.dart';
import 'package:mobile_app/services/notification_service.dart';
import 'package:mobile_app/services/preferences_storage_service.dart';
import 'package:mobile_app/services/socket_service.dart';
import 'package:mobile_app/services/token_api_service.dart';
import 'package:mobile_app/widgets/reminder_caution.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// ADR-062: the reminder time is the customer's own — a suggested value or
/// any whole number of minutes — or each queue's default; the switches and
/// the permission row show and change what is really in force.

class _FakeNotificationService extends NotificationService {
  _FakeNotificationService({required this.enabled});

  bool enabled;
  bool grantWhenAsked = true;
  int requests = 0;
  final applied = <(bool, bool)>[];

  @override
  Future<bool> areNotificationsEnabled() async => enabled;

  @override
  Future<bool> requestPermission() async {
    requests++;
    enabled = grantWhenAsked;
    return enabled;
  }

  @override
  Future<void> applyAlertPreferences({
    required bool soundEnabled,
    required bool vibrationEnabled,
  }) async {
    applied.add((soundEnabled, vibrationEnabled));
  }
}

const _prefsKey = 'notification_preferences';

void main() {
  late _FakeNotificationService notifications;
  late List<NotificationPreferences> registered;
  late List<NotificationPreferences> changes;

  /// What the backend says about the customer's active tokens.
  late List<TokenReminderStatus> Function(NotificationPreferences) backendAnswer;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    notifications = _FakeNotificationService(enabled: true);
    registered = [];
    changes = [];
    backendAnswer = (_) => const [];
  });

  Future<NotificationPreferencesProvider> pumpScreen(WidgetTester tester) async {
    // Tall enough that the whole list is built: a lazily-built row below the
    // fold cannot be found, and these tests are not about scrolling.
    tester.view.physicalSize = const Size(800, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final provider = NotificationPreferencesProvider(
      repository: NotificationPreferencesRepository(storageService: PreferencesStorageService()),
      notificationService: notifications,
      registerWithActiveTokens: (preferences) async {
        registered.add(preferences);
        return backendAnswer(preferences);
      },
      onChanged: changes.add,
    );
    final active = ActiveTokenProvider(
      tokenRepository: TokenRepository(
        apiService: TokenApiService(ApiClient(baseUrl: 'http://localhost:4000')),
        socketService: SocketService(),
      ),
      storage: ActiveTokenStorageService(),
    );
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<NotificationPreferencesProvider>.value(value: provider),
          ChangeNotifierProvider<ActiveTokenProvider>.value(value: active),
        ],
        child: const MaterialApp(home: NotificationSettingsScreen()),
      ),
    );
    await tester.pumpAndSettle();
    return provider;
  }

  int? selectedOption(WidgetTester tester) =>
      tester.widget<RadioGroup<int>>(find.byType(RadioGroup<int>)).groupValue;

  TokenReminderStatus status(NotificationPreferences prefs, {required int? wait}) => TokenReminderStatus(
        tokenId: 'token-1',
        reminderMinutes: prefs.effectiveReminderMinutes(queueDefaultMinutes: 10),
        followsQueueDefault: prefs.followsQueueDefault,
        queueDefaultReminderMinutes: 10,
        status: TokenStatus.waiting,
        estimatedWaitMinutes: wait,
      );

  group('Enable notifications', () {
    testWidgets('shows Enabled straight away when the permission is already granted', (tester) async {
      await pumpScreen(tester);

      expect(find.text('Enabled'), findsOneWidget);
      expect(find.text('Tap to allow notifications'), findsNothing);
      expect(notifications.requests, 0, reason: 'reading the state must not prompt');
    });

    testWidgets('offers to allow them when the permission is not granted, and asks on tap', (tester) async {
      notifications.enabled = false;
      await pumpScreen(tester);
      expect(find.text('Tap to allow notifications'), findsOneWidget);

      await tester.tap(find.text('Enable notifications'));
      await tester.pumpAndSettle();

      expect(notifications.requests, 1);
      expect(find.text('Enabled'), findsOneWidget);
    });

    testWidgets('picks up a permission changed in system settings when the app resumes', (tester) async {
      notifications.enabled = false;
      await pumpScreen(tester);
      expect(find.text('Tap to allow notifications'), findsOneWidget);

      notifications.enabled = true;
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();

      expect(find.text('Enabled'), findsOneWidget);
    });
  });

  group('reminder time', () {
    testWidgets("a new install follows each queue's default", (tester) async {
      final provider = await pumpScreen(tester);

      expect(selectedOption(tester), 0);
      expect(provider.preferences.followsQueueDefault, isTrue);
      expect(find.text('You will be reminded at the time each queue has chosen.'), findsOneWidget);
    });

    testWidgets('choosing a suggested time makes it the customer own, and tells the backend', (tester) async {
      final provider = await pumpScreen(tester);

      await tester.tap(find.text('15 minutes'));
      await tester.pumpAndSettle();

      expect(provider.preferences.reminderMinutesBeforeTurn, 15);
      expect(registered.last.reminderMinutesBeforeTurn, 15);
      expect(changes.last.reminderMinutesBeforeTurn, 15);
      expect(find.textContaining('Your choice replaces the time a queue has set'), findsOneWidget);
    });

    testWidgets("going back to the queue's default clears the customer's own time", (tester) async {
      SharedPreferences.setMockInitialValues({
        _prefsKey: '{"reminderMinutesBeforeTurn":15,"soundEnabled":true,"vibrationEnabled":true}',
      });
      final provider = await pumpScreen(tester);
      expect(selectedOption(tester), 15);

      await tester.tap(find.text("Queue's default"));
      await tester.pumpAndSettle();

      expect(provider.preferences.reminderMinutesBeforeTurn, isNull);
      expect(registered.last.reminderMinutesBeforeTurn, isNull);
    });

    testWidgets('a custom number of minutes can be typed in', (tester) async {
      final provider = await pumpScreen(tester);

      await tester.tap(find.text('Custom'));
      await tester.pumpAndSettle();
      // Nothing is saved until there is a valid number to save.
      expect(provider.preferences.reminderMinutesBeforeTurn, isNull);

      await tester.enterText(find.byType(TextField), '37');
      await tester.pumpAndSettle();

      expect(provider.preferences.reminderMinutesBeforeTurn, 37);
      expect(registered.last.reminderMinutesBeforeTurn, 37);
      expect(selectedOption(tester), -1);
    });

    testWidgets('a custom time outside 2–120 is refused with an explanation', (tester) async {
      final provider = await pumpScreen(tester);
      await tester.tap(find.text('Custom'));
      await tester.pumpAndSettle();

      for (final input in ['1', '121', '0']) {
        await tester.enterText(find.byType(TextField), input);
        await tester.pumpAndSettle();

        expect(find.text('Enter a whole number from 2 to 120.'), findsOneWidget, reason: 'input $input');
        expect(provider.preferences.reminderMinutesBeforeTurn, isNull, reason: 'input $input');
      }

      await tester.enterText(find.byType(TextField), '120');
      await tester.pumpAndSettle();
      expect(find.text('Enter a whole number from 2 to 120.'), findsNothing);
      expect(provider.preferences.reminderMinutesBeforeTurn, 120);
    });

    testWidgets('a saved custom time is shown again as Custom with its number', (tester) async {
      SharedPreferences.setMockInitialValues({
        _prefsKey: '{"reminderMinutesBeforeTurn":37,"soundEnabled":true,"vibrationEnabled":true}',
      });
      await pumpScreen(tester);

      expect(selectedOption(tester), -1);
      expect(tester.widget<TextField>(find.byType(TextField)).controller?.text, '37');
    });
  });

  group('caution when the wait is shorter than the reminder', () {
    testWidgets('is shown for an active token whose turn is closer than the chosen time', (tester) async {
      backendAnswer = (prefs) => [status(prefs, wait: 3)];
      await pumpScreen(tester);
      // Queue default of 10 against a 3-minute wait.
      expect(find.byType(ReminderCaution), findsOneWidget);
      expect(find.textContaining('about 3 min away — sooner than a 10-minute reminder'), findsOneWidget);

      await tester.tap(find.text('2 minutes'));
      await tester.pumpAndSettle();

      expect(find.byType(ReminderCaution), findsNothing);
    });

    testWidgets('appears as soon as a longer custom time is entered', (tester) async {
      backendAnswer = (prefs) => [status(prefs, wait: 25)];
      await pumpScreen(tester);
      expect(find.byType(ReminderCaution), findsNothing);

      await tester.tap(find.text('Custom'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), '40');
      await tester.pumpAndSettle();

      expect(find.textContaining('about 25 min away — sooner than a 40-minute reminder'), findsOneWidget);
    });

    testWidgets('is not shown with no active token, or no estimate', (tester) async {
      backendAnswer = (prefs) => [status(prefs, wait: null)];
      await pumpScreen(tester);

      expect(find.byType(ReminderCaution), findsNothing);
    });
  });

  group('Sound and Vibration', () {
    testWidgets('the saved choice is applied to the notification channels on load', (tester) async {
      SharedPreferences.setMockInitialValues({
        _prefsKey: '{"reminderMinutesBeforeTurn":null,"soundEnabled":false,"vibrationEnabled":true}',
      });
      await pumpScreen(tester);

      expect(notifications.applied.last, (false, true));
    });

    testWidgets('switching one off is applied, saved and sent to the backend', (tester) async {
      final provider = await pumpScreen(tester);

      await tester.tap(find.widgetWithText(SwitchListTile, 'Sound'));
      await tester.pumpAndSettle();

      expect(provider.preferences.soundEnabled, isFalse);
      expect(notifications.applied.last, (false, true));
      expect(registered.last.soundEnabled, isFalse);
      final stored = (await SharedPreferences.getInstance()).getString(_prefsKey);
      expect(stored, contains('"soundEnabled":false'));

      await tester.tap(find.widgetWithText(SwitchListTile, 'Vibration'));
      await tester.pumpAndSettle();

      expect(notifications.applied.last, (false, false));
      expect(registered.last.vibrationEnabled, isFalse);
    });
  });
}
