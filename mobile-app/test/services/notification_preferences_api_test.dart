import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/models/live_queue_token.dart';
import 'package:mobile_app/models/notification_preferences.dart';
import 'package:mobile_app/models/token_reminder_status.dart';
import 'package:mobile_app/repositories/device_repository.dart';
import 'package:mobile_app/repositories/token_repository.dart';
import 'package:mobile_app/services/api_client.dart';
import 'package:mobile_app/services/device_api_service.dart';
import 'package:mobile_app/services/device_identity_service.dart';
import 'package:mobile_app/services/notification_service.dart';
import 'package:mobile_app/services/socket_service.dart';
import 'package:mobile_app/services/token_api_service.dart';
import 'package:mobile_app/utils/reminder_registration.dart';

/// ADR-062: registering a token's notification preferences with the backend,
/// and reading back which reminder time is in force.

Map<String, dynamic> _answer({
  String tokenId = 'token-1',
  int reminderMinutes = 10,
  String source = 'QUEUE_DEFAULT',
  int? wait = 12,
}) =>
    {
      'tokenId': tokenId,
      'reminderMinutes': reminderMinutes,
      'reminderSource': source,
      'queueDefaultReminderMinutes': 10,
      'soundEnabled': true,
      'vibrationEnabled': true,
      'notificationsEnabled': true,
      'status': 'WAITING',
      'estimatedWaitMinutes': wait,
    };

class _FakeDeviceRepository extends DeviceRepository {
  _FakeDeviceRepository({this.fails = false})
      : super(
          identityService: DeviceIdentityService(),
          apiService: DeviceApiService(ApiClient(baseUrl: 'http://localhost:4000')),
        );

  final bool fails;

  @override
  Future<String> ensureRegisteredDevice() async {
    if (fails) throw StateError('no device');
    return 'device-1';
  }
}

void main() {
  group('TokenApiService.setNotificationPreferences', () {
    test("sends the customer's own time, sound and vibration", () async {
      late http.Request sent;
      final service = TokenApiService(
        ApiClient(
          baseUrl: 'http://localhost:4000',
          httpClient: MockClient((request) async {
            sent = request;
            return http.Response(
              jsonEncode({'success': true, 'data': _answer(reminderMinutes: 37, source: 'CUSTOMER')}),
              200,
            );
          }),
        ),
      );

      final status = await service.setNotificationPreferences(
        'token-1',
        'device-1',
        const NotificationPreferences(reminderMinutesBeforeTurn: 37, soundEnabled: false),
      );

      expect(sent.method, 'PUT');
      expect(sent.url.path, '/api/tokens/token-1/notification-preferences');
      expect(jsonDecode(sent.body), {
        'deviceIdentifier': 'device-1',
        'reminderMinutes': 37,
        'soundEnabled': false,
        'vibrationEnabled': true,
      });
      expect(status.reminderMinutes, 37);
      expect(status.followsQueueDefault, isFalse);
    });

    test("sends an explicit null when the customer follows the queue's default", () async {
      late Map<String, dynamic> body;
      final service = TokenApiService(
        ApiClient(
          baseUrl: 'http://localhost:4000',
          httpClient: MockClient((request) async {
            body = jsonDecode(request.body) as Map<String, dynamic>;
            return http.Response(jsonEncode({'success': true, 'data': _answer()}), 200);
          }),
        ),
      );

      final status = await service.setNotificationPreferences(
        'token-1',
        'device-1',
        const NotificationPreferences(),
      );

      expect(body.containsKey('reminderMinutes'), isTrue);
      expect(body['reminderMinutes'], isNull);
      expect(status.followsQueueDefault, isTrue);
      expect(status.queueDefaultReminderMinutes, 10);
    });
  });

  group('TokenReminderStatus', () {
    test('a wait shorter than the reminder is flagged', () {
      final status = TokenReminderStatus.fromJson(_answer(reminderMinutes: 15, wait: 4));
      expect(status.waitIsShorterThanReminder, isTrue);
    });

    test('a wait equal to or longer than the reminder is not', () {
      expect(
        TokenReminderStatus.fromJson(_answer(reminderMinutes: 15, wait: 15)).waitIsShorterThanReminder,
        isFalse,
      );
      expect(
        TokenReminderStatus.fromJson(_answer(reminderMinutes: 15, wait: 40)).waitIsShorterThanReminder,
        isFalse,
      );
    });

    test('nothing is flagged without an estimate, or once the token is no longer waiting', () {
      expect(
        TokenReminderStatus.fromJson(_answer(reminderMinutes: 15, wait: null)).waitIsShorterThanReminder,
        isFalse,
      );
      expect(
        reminderLeadIsTooShort(status: TokenStatus.called, estimatedWaitMinutes: 1, reminderMinutes: 15),
        isFalse,
      );
    });
  });

  group('registerReminderPreferences', () {
    TokenRepository repositoryAnswering(Future<http.Response> Function(http.Request) handler) {
      return TokenRepository(
        apiService: TokenApiService(
          ApiClient(baseUrl: 'http://localhost:4000', httpClient: MockClient(handler)),
        ),
        socketService: SocketService(),
      );
    }

    test('registers every active token and returns what the backend said about each', () async {
      final paths = <String>[];
      final repository = repositoryAnswering((request) async {
        paths.add(request.url.path);
        final tokenId = request.url.pathSegments[2];
        return http.Response(jsonEncode({'success': true, 'data': _answer(tokenId: tokenId)}), 200);
      });

      final statuses = await registerReminderPreferences(
        tokenIds: ['token-a', 'token-b'],
        preferences: const NotificationPreferences(),
        deviceRepository: _FakeDeviceRepository(),
        tokenRepository: repository,
      );

      expect(statuses.map((s) => s.tokenId), ['token-a', 'token-b']);
      expect(paths, hasLength(2));
    });

    test('one token failing does not lose the others', () async {
      final repository = repositoryAnswering((request) async {
        final tokenId = request.url.pathSegments[2];
        if (tokenId == 'token-gone') {
          return http.Response(
            jsonEncode({
              'success': false,
              'error': {'code': 'TOKEN_NOT_FOUND', 'message': 'Token not found.'},
            }),
            404,
          );
        }
        return http.Response(jsonEncode({'success': true, 'data': _answer(tokenId: tokenId)}), 200);
      });

      final statuses = await registerReminderPreferences(
        tokenIds: ['token-gone', 'token-b'],
        preferences: const NotificationPreferences(),
        deviceRepository: _FakeDeviceRepository(),
        tokenRepository: repository,
      );

      expect(statuses.map((s) => s.tokenId), ['token-b']);
    });

    test('makes no request when there are no active tokens, or no device', () async {
      var requests = 0;
      final repository = repositoryAnswering((request) async {
        requests++;
        return http.Response(jsonEncode({'success': true, 'data': _answer()}), 200);
      });

      expect(
        await registerReminderPreferences(
          tokenIds: const [],
          preferences: const NotificationPreferences(),
          deviceRepository: _FakeDeviceRepository(),
          tokenRepository: repository,
        ),
        isEmpty,
      );
      expect(
        await registerReminderPreferences(
          tokenIds: ['token-a'],
          preferences: const NotificationPreferences(),
          deviceRepository: _FakeDeviceRepository(fails: true),
          tokenRepository: repository,
        ),
        isEmpty,
      );
      expect(requests, 0);
    });
  });

  group('notification channels — the contract with the backend', () {
    // backend/src/utils/notificationChannel.ts builds the same ids for pushes
    // shown while the app is closed.
    test('each Sound / Vibration combination has its own channel id', () {
      expect(androidChannelId('turn_alert', soundEnabled: true, vibrationEnabled: true), 'turn_alert');
      expect(
        androidChannelId('turn_alert', soundEnabled: true, vibrationEnabled: false),
        'turn_alert_sound_only',
      );
      expect(
        androidChannelId('queue_updates', soundEnabled: false, vibrationEnabled: true),
        'queue_updates_vibrate_only',
      );
      expect(
        androidChannelId('queue_updates', soundEnabled: false, vibrationEnabled: false),
        'queue_updates_silent',
      );
    });

    test('a reminder can be claimed exactly once per token', () {
      final service = NotificationService();
      expect(service.claimReminder('token-1'), isTrue);
      expect(service.claimReminder('token-1'), isFalse);
      expect(service.claimReminder('token-2'), isTrue);
    });
  });
}
