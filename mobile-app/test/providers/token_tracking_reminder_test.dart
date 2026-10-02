import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/models/live_queue_token.dart';
import 'package:mobile_app/models/notification_preferences.dart';
import 'package:mobile_app/models/token_reminder_status.dart';
import 'package:mobile_app/providers/token_tracking_provider.dart';
import 'package:mobile_app/repositories/device_repository.dart';
import 'package:mobile_app/repositories/history_repository.dart';
import 'package:mobile_app/repositories/token_repository.dart';
import 'package:mobile_app/services/api_client.dart';
import 'package:mobile_app/services/api_exception.dart';
import 'package:mobile_app/services/device_api_service.dart';
import 'package:mobile_app/services/device_identity_service.dart';
import 'package:mobile_app/services/fcm_service.dart';
import 'package:mobile_app/services/history_storage_service.dart';
import 'package:mobile_app/services/notification_service.dart';
import 'package:mobile_app/services/socket_service.dart';
import 'package:mobile_app/services/token_api_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// ADR-062: whose reminder time applies to a tracked token, when the app
/// raises the reminder itself, and when it warns that the reminder cannot
/// give the notice it promises.

final _apiClient = ApiClient(baseUrl: 'http://localhost:4000');

class _FakeTokenRepository extends TokenRepository {
  _FakeTokenRepository()
      : super(apiService: TokenApiService(_apiClient), socketService: SocketService());

  final positions = StreamController<PositionUpdate>.broadcast();
  final registered = <NotificationPreferences>[];

  /// What the backend reports as this queue's default reminder time.
  int queueDefaultMinutes = 10;
  bool backendReachable = true;
  bool socketAlreadyConnected = false;

  @override
  bool get isSocketConnected => socketAlreadyConnected;

  @override
  Stream<LiveQueueToken> get tokenLifecycleUpdates => const Stream.empty();
  @override
  Stream<bool> get connectionStatus => const Stream.empty();
  @override
  Stream<PositionUpdate> get positionUpdates => positions.stream;
  @override
  Stream<QueueStatusUpdate> get queueStatusUpdates => const Stream.empty();
  @override
  void connectSocket() {}
  @override
  Future<void> joinTokenRoom(String tokenId) async {}
  @override
  Future<void> joinQueueRoom(String queueId) async {}
  @override
  void stopTracking() {}

  @override
  Future<TokenReminderStatus> setNotificationPreferences(
    String tokenId,
    String deviceIdentifier,
    NotificationPreferences preferences,
  ) async {
    if (!backendReachable) throw const NetworkException('offline');
    registered.add(preferences);
    return TokenReminderStatus(
      tokenId: tokenId,
      reminderMinutes: preferences.reminderMinutesBeforeTurn ?? queueDefaultMinutes,
      followsQueueDefault: preferences.followsQueueDefault,
      queueDefaultReminderMinutes: queueDefaultMinutes,
      status: TokenStatus.waiting,
      estimatedWaitMinutes: null,
    );
  }
}

class _FakeDeviceRepository extends DeviceRepository {
  _FakeDeviceRepository()
      : super(identityService: DeviceIdentityService(), apiService: DeviceApiService(_apiClient));

  @override
  Future<String> ensureRegisteredDevice() async => 'device-1';
}

class _RecordingNotificationService extends NotificationService {
  final reminders = <int>[];

  @override
  Future<void> showReminder({
    required String serialNumber,
    required int estimatedWaitMinutes,
    required bool soundEnabled,
    required bool vibrationEnabled,
  }) async {
    reminders.add(estimatedWaitMinutes);
  }
}

LiveQueueToken _waiting({int? wait = 30, bool reminderSent = false}) {
  return LiveQueueToken(
    id: 'token-1',
    queueId: 'queue-1',
    serviceId: 'service-1',
    serialNumber: 'A007',
    status: TokenStatus.waiting,
    formData: const {},
    position: 4,
    estimatedWaitMinutes: wait,
    estimatedReadyAt: null,
    counter: null,
    createdAt: DateTime.utc(2026, 1, 1),
    reminderSent: reminderSent,
  );
}

void main() {
  late _FakeTokenRepository tokens;
  late _RecordingNotificationService notifications;
  late TokenTrackingProvider provider;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    tokens = _FakeTokenRepository();
    notifications = _RecordingNotificationService();
    provider = TokenTrackingProvider(
      tokenRepository: tokens,
      deviceRepository: _FakeDeviceRepository(),
      historyRepository: HistoryRepository(storageService: HistoryStorageService()),
      notificationService: notifications,
      fcmService: FcmService(notificationService: notifications),
    );
  });

  tearDown(() => provider.stop());

  Future<void> moveTo(int wait) async {
    tokens.positions.add(
      PositionUpdate(position: 1, estimatedWaitMinutes: wait, estimatedReadyAt: null),
    );
    await pumpEventQueue();
  }

  group('whose reminder time applies', () {
    test("with no time of the customer's own, the queue's default is used", () async {
      tokens.queueDefaultMinutes = 25;
      provider.start(_waiting(), const NotificationPreferences());
      await pumpEventQueue();

      expect(provider.reminderMinutes, 25);
      expect(provider.reminderFollowsQueueDefault, isTrue);
    });

    test("the customer's own time overrides the queue's default", () async {
      tokens.queueDefaultMinutes = 25;
      provider.start(_waiting(), const NotificationPreferences(reminderMinutesBeforeTurn: 4));
      await pumpEventQueue();

      expect(provider.reminderMinutes, 4);
      expect(provider.reminderFollowsQueueDefault, isFalse);
    });

    test('the usual default is assumed while the backend cannot be reached', () async {
      tokens.backendReachable = false;
      provider.start(_waiting(), const NotificationPreferences());
      await pumpEventQueue();

      expect(provider.reminderMinutes, NotificationPreferences.assumedQueueDefaultMinutes);
    });

    test('a queue default learned for one token is not carried over to the next', () async {
      tokens.queueDefaultMinutes = 25;
      provider.start(_waiting(), const NotificationPreferences());
      await pumpEventQueue();
      expect(provider.reminderMinutes, 25);

      tokens.backendReachable = false;
      provider.start(_waiting(), const NotificationPreferences());
      await pumpEventQueue();

      expect(provider.reminderMinutes, NotificationPreferences.assumedQueueDefaultMinutes);
    });
  });

  group('telling the backend', () {
    test('starting to track registers the preferences for that token', () async {
      const prefs = NotificationPreferences(reminderMinutesBeforeTurn: 7, soundEnabled: false);
      provider.start(_waiting(), prefs);
      await pumpEventQueue();

      expect(tokens.registered, [same(prefs)]);
    });

    test('a setting changed while tracking is registered at once', () async {
      provider.start(_waiting(), const NotificationPreferences());
      await pumpEventQueue();

      const changed = NotificationPreferences(reminderMinutesBeforeTurn: 15);
      provider.updatePreferences(changed);
      await pumpEventQueue();

      expect(tokens.registered.last, same(changed));
      expect(provider.reminderMinutes, 15);
    });

    test('a setting changed with nothing being tracked registers nothing', () async {
      provider.updatePreferences(const NotificationPreferences(reminderMinutesBeforeTurn: 15));
      await pumpEventQueue();

      expect(tokens.registered, isEmpty);
    });
  });

  group('the reminder raised while Live Tracking is open', () {
    test("fires once the wait reaches the customer's own time, not the queue's", () async {
      tokens.queueDefaultMinutes = 20;
      provider.start(_waiting(), const NotificationPreferences(reminderMinutesBeforeTurn: 5));
      await pumpEventQueue();

      await moveTo(15);
      expect(notifications.reminders, isEmpty);

      await moveTo(5);
      expect(notifications.reminders, [5]);
    });

    test("fires at the queue's default when the customer chose none", () async {
      tokens.queueDefaultMinutes = 20;
      provider.start(_waiting(), const NotificationPreferences());
      await pumpEventQueue();

      await moveTo(18);

      expect(notifications.reminders, [18]);
    });

    test('is raised only once however far the queue moves', () async {
      provider.start(_waiting(), const NotificationPreferences(reminderMinutesBeforeTurn: 10));
      await pumpEventQueue();

      await moveTo(9);
      await moveTo(6);
      await moveTo(2);

      expect(notifications.reminders, [9]);
    });

    test('stays quiet when the backend has already pushed it', () async {
      provider.start(
        _waiting(reminderSent: true),
        const NotificationPreferences(reminderMinutesBeforeTurn: 10),
      );
      await pumpEventQueue();

      await moveTo(4);

      expect(notifications.reminders, isEmpty);
    });

    test('stays quiet when a push for this token was already shown in the foreground', () async {
      provider.start(_waiting(), const NotificationPreferences(reminderMinutesBeforeTurn: 10));
      await pumpEventQueue();
      // What FcmService does on receiving the backend's reminder push.
      notifications.claimReminder('token-1');

      await moveTo(4);

      expect(notifications.reminders, isEmpty);
    });

    test('is not repeated when the same token is opened again', () async {
      const prefs = NotificationPreferences(reminderMinutesBeforeTurn: 10);
      provider.start(_waiting(), prefs);
      await pumpEventQueue();
      await moveTo(8);

      provider.stop();
      provider.start(_waiting(wait: 8), prefs);
      await pumpEventQueue();
      await moveTo(6);

      expect(notifications.reminders, [8]);
    });
  });

  group('the connection indicator', () {
    // The socket outlives a tracking session, and only reports changes.
    test('opening a token on an already-connected socket shows it as connected', () {
      tokens.socketAlreadyConnected = true;

      provider.start(_waiting(), const NotificationPreferences());

      expect(provider.isConnected, isTrue);
    });

    test('a first connection still waits for the socket to say so', () {
      provider.start(_waiting(), const NotificationPreferences());

      expect(provider.isConnected, isFalse);
    });
  });

  group('the caution for a reminder longer than the wait', () {
    test('is raised when the turn is already closer than the reminder time', () async {
      provider.start(_waiting(wait: 3), const NotificationPreferences(reminderMinutesBeforeTurn: 15));
      await pumpEventQueue();

      expect(provider.reminderLeadTooShort, isTrue);
    });

    test('is not raised when there is still time for the reminder', () async {
      provider.start(_waiting(wait: 30), const NotificationPreferences(reminderMinutesBeforeTurn: 15));
      await pumpEventQueue();

      expect(provider.reminderLeadTooShort, isFalse);
    });

    test("uses the queue's default once the backend has reported it", () async {
      // Shorter than the assumed default of 10, but not than this queue's 5.
      tokens.queueDefaultMinutes = 5;
      provider.start(_waiting(wait: 8), const NotificationPreferences());
      expect(provider.reminderLeadTooShort, isTrue);

      await pumpEventQueue();

      expect(provider.reminderLeadTooShort, isFalse);
    });

    test('follows a change of setting made while tracking', () async {
      provider.start(_waiting(wait: 8), const NotificationPreferences(reminderMinutesBeforeTurn: 5));
      await pumpEventQueue();
      expect(provider.reminderLeadTooShort, isFalse);

      provider.updatePreferences(const NotificationPreferences(reminderMinutesBeforeTurn: 20));

      expect(provider.reminderLeadTooShort, isTrue);
    });

    test('does not appear just because the wait counted down past the reminder', () async {
      provider.start(_waiting(wait: 30), const NotificationPreferences(reminderMinutesBeforeTurn: 10));
      await pumpEventQueue();

      await moveTo(4);

      expect(notifications.reminders, [4]);
      expect(provider.reminderLeadTooShort, isFalse);
    });

    test('is not raised when the reminder has already gone out', () async {
      provider.start(
        _waiting(wait: 3, reminderSent: true),
        const NotificationPreferences(reminderMinutesBeforeTurn: 15),
      );
      await pumpEventQueue();

      expect(provider.reminderLeadTooShort, isFalse);
    });

    test('is not raised without an estimate to compare against', () async {
      provider.start(_waiting(wait: null), const NotificationPreferences(reminderMinutesBeforeTurn: 15));
      await pumpEventQueue();

      expect(provider.reminderLeadTooShort, isFalse);
    });
  });
}
