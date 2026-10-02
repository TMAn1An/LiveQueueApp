import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/models/live_queue_token.dart';
import 'package:mobile_app/models/notification_preferences.dart';
import 'package:mobile_app/models/service_start_verification_code.dart';
import 'package:mobile_app/models/token_reminder_status.dart';
import 'package:mobile_app/providers/token_tracking_provider.dart';
import 'package:mobile_app/repositories/device_repository.dart';
import 'package:mobile_app/repositories/history_repository.dart';
import 'package:mobile_app/repositories/token_repository.dart';
import 'package:mobile_app/services/api_client.dart';
import 'package:mobile_app/services/device_api_service.dart';
import 'package:mobile_app/services/device_identity_service.dart';
import 'package:mobile_app/services/fcm_service.dart';
import 'package:mobile_app/services/history_storage_service.dart';
import 'package:mobile_app/services/notification_service.dart';
import 'package:mobile_app/services/socket_service.dart';
import 'package:mobile_app/services/token_api_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// ADR-041: the tracking provider fetches the service-start code only for a
/// queue that asks for one, and follows the setting when it changes while
/// the customer is already CALLED — always from the backend's own answer on
/// the token, never a local guess.

final _apiClient = ApiClient(baseUrl: 'http://localhost:4000');

class _FakeTokenRepository extends TokenRepository {
  _FakeTokenRepository()
      : super(apiService: TokenApiService(_apiClient), socketService: SocketService());

  final lifecycle = StreamController<LiveQueueToken>.broadcast();
  int codeFetches = 0;

  @override
  Stream<LiveQueueToken> get tokenLifecycleUpdates => lifecycle.stream;
  @override
  Stream<bool> get connectionStatus => const Stream.empty();
  @override
  Stream<PositionUpdate> get positionUpdates => const Stream.empty();
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

  /// Not what these tests are about — kept off the network.
  @override
  Future<TokenReminderStatus> setNotificationPreferences(
    String tokenId,
    String deviceIdentifier,
    NotificationPreferences preferences,
  ) async =>
      throw StateError('not under test');

  @override
  Future<ServiceStartVerificationCode> getVerificationCode(String tokenId, String deviceIdentifier) async {
    codeFetches++;
    return ServiceStartVerificationCode(
      code: '482731',
      expiresAt: DateTime.now().add(const Duration(minutes: 5)),
    );
  }
}

class _FakeDeviceRepository extends DeviceRepository {
  _FakeDeviceRepository()
      : super(identityService: DeviceIdentityService(), apiService: DeviceApiService(_apiClient));

  @override
  Future<String> ensureRegisteredDevice() async => 'device-1';
}

LiveQueueToken _token({required TokenStatus status, required bool verificationRequired}) {
  return LiveQueueToken(
    id: 'token-1',
    queueId: 'queue-1',
    serviceId: 'service-1',
    serialNumber: 'A007',
    status: status,
    formData: const {},
    position: null,
    estimatedWaitMinutes: null,
    estimatedReadyAt: null,
    counter: null,
    createdAt: DateTime.utc(2026, 1, 1),
    calledAt: status == TokenStatus.called ? DateTime.utc(2026, 1, 1, 10) : null,
    serviceStartVerificationRequired: verificationRequired,
  );
}

void main() {
  late _FakeTokenRepository tokens;
  late TokenTrackingProvider provider;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    tokens = _FakeTokenRepository();
    provider = TokenTrackingProvider(
      tokenRepository: tokens,
      deviceRepository: _FakeDeviceRepository(),
      historyRepository: HistoryRepository(storageService: HistoryStorageService()),
      notificationService: NotificationService(),
      fcmService: FcmService(notificationService: NotificationService()),
    );
  });

  tearDown(() {
    provider.stop();
  });

  Future<void> push(LiveQueueToken token) async {
    tokens.lifecycle.add(token);
    await pumpEventQueue();
  }

  test('a CALLED token on a code-requiring queue fetches its code', () async {
    provider.start(
      _token(status: TokenStatus.called, verificationRequired: true),
      const NotificationPreferences(),
    );
    await pumpEventQueue();

    expect(tokens.codeFetches, 1);
    expect(provider.verificationCode, '482731');
  });

  test('a CALLED token on a queue without the code never asks for one', () async {
    provider.start(
      _token(status: TokenStatus.called, verificationRequired: false),
      const NotificationPreferences(),
    );
    await pumpEventQueue();

    expect(tokens.codeFetches, 0);
    expect(provider.verificationCode, isNull);
  });

  test('entering CALLED on a queue without the code fetches nothing', () async {
    provider.start(
      _token(status: TokenStatus.waiting, verificationRequired: false),
      const NotificationPreferences(),
    );
    await push(_token(status: TokenStatus.called, verificationRequired: false));

    expect(provider.token!.status, TokenStatus.called);
    expect(tokens.codeFetches, 0);
    expect(provider.verificationCode, isNull);
  });

  test('switched ON while already CALLED: the newly issued code is fetched', () async {
    provider.start(
      _token(status: TokenStatus.called, verificationRequired: false),
      const NotificationPreferences(),
    );
    await pumpEventQueue();
    expect(tokens.codeFetches, 0);

    await push(_token(status: TokenStatus.called, verificationRequired: true));

    expect(tokens.codeFetches, 1);
    expect(provider.verificationCode, '482731');
  });

  test('switched OFF while already CALLED: the local code is dropped', () async {
    provider.start(
      _token(status: TokenStatus.called, verificationRequired: true),
      const NotificationPreferences(),
    );
    await pumpEventQueue();
    expect(provider.verificationCode, '482731');

    await push(_token(status: TokenStatus.called, verificationRequired: false));

    expect(provider.verificationCode, isNull);
    expect(provider.verificationCodeExpiresAt, isNull);
    expect(tokens.codeFetches, 1);
  });

  test('a repeated CALLED update with the setting unchanged does not re-fetch', () async {
    provider.start(
      _token(status: TokenStatus.called, verificationRequired: true),
      const NotificationPreferences(),
    );
    await pumpEventQueue();

    await push(_token(status: TokenStatus.called, verificationRequired: true));

    expect(tokens.codeFetches, 1);
  });
}
