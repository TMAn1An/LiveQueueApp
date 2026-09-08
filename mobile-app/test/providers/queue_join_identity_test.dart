import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/providers/queue_join_provider.dart';
import 'package:mobile_app/repositories/device_repository.dart';
import 'package:mobile_app/repositories/history_repository.dart';
import 'package:mobile_app/repositories/phone_verification_repository.dart';
import 'package:mobile_app/repositories/queue_repository.dart';
import 'package:mobile_app/repositories/token_repository.dart';
import 'package:mobile_app/services/api_client.dart';
import 'package:mobile_app/services/device_api_service.dart';
import 'package:mobile_app/services/device_identity_service.dart';
import 'package:mobile_app/services/history_storage_service.dart';
import 'package:mobile_app/services/phone_verification_api_service.dart';
import 'package:mobile_app/services/queue_api_service.dart';
import 'package:mobile_app/services/socket_service.dart';
import 'package:mobile_app/services/token_api_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The join flow for a queue that limits repeat visits (ADR-034): the app
/// asks the customer who they are, and carries a server-issued proof — never
/// a claim of its own — into the join.

Map<String, dynamic> _queueJson({Map<String, dynamic>? identity}) => {
      'id': 'queue-1',
      'name': 'Relief Distribution',
      'description': null,
      'status': 'ACTIVE',
      'clientTerminology': null,
      'allowMultipleServices': true,
      'identity': ?identity,
      'services': [
        {
          'id': 'service-1',
          'serviceName': 'Collection',
          'description': null,
          'durationMinutes': 5,
        },
      ],
      'formFields': [
        {
          'id': 'field-1',
          'key': 'nid',
          'label': 'NID Number',
          'type': 'text',
          'required': true,
          'placeholder': null,
          'options': [],
          'sortOrder': 0,
        },
      ],
    };

Map<String, dynamic> _tokenJson() => {
      'id': 'token-1',
      'queueId': 'queue-1',
      'serviceId': 'service-1',
      'serialNumber': 'A001',
      'status': 'WAITING',
      'formData': {'nid': 'A-123'},
      'position': 1,
      'estimatedWaitMinutes': 5,
      'counter': null,
      'createdAt': DateTime.utc(2026, 1, 1).toIso8601String(),
      'calledAt': null,
      'startedAt': null,
      'completedAt': null,
      'skippedAt': null,
    };

Map<String, dynamic> _phoneIdentity() => {
      'repeatRestricted': true,
      'restrictionType': 'ONCE_EVER',
      'identityMode': 'VERIFIED_PHONE',
      'identityFieldKey': null,
      'requiresVerifiedPhone': true,
      'configurationRequired': false,
    };

QueueJoinProvider _buildProvider(http.Client mockClient) {
  final apiClient = ApiClient(httpClient: mockClient, baseUrl: 'http://localhost:4000');
  return QueueJoinProvider(
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
    phoneVerificationRepository: PhoneVerificationRepository(
      apiService: PhoneVerificationApiService(apiClient),
    ),
  );
}

http.Response _ok(Map<String, dynamic> data, [int status = 200]) =>
    http.Response(jsonEncode({'success': true, 'data': data}), status);

http.Response _err(
  String code,
  String message, {
  int status = 400,
  Map<String, dynamic>? details,
}) =>
    http.Response(
      jsonEncode({
        'success': false,
        'error': {
          'code': code,
          'message': message,
          'details': ?details,
        },
      }),
      status,
    );

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('what the queue asks for', () {
    test('reads the identity requirement from the queue config', () async {
      final provider = _buildProvider(
        MockClient((_) async => _ok(_queueJson(identity: _phoneIdentity()))),
      );

      await provider.loadQueueById('queue-1');

      expect(provider.requiresPhoneVerification, isTrue);
      expect(provider.canSubmitJoin, isFalse);
      expect(provider.queueConfig!.identity.restrictionType, 'ONCE_EVER');
    });

    test('names the question that identifies the customer', () async {
      final provider = _buildProvider(
        MockClient((_) async => _ok(_queueJson(identity: {
              'repeatRestricted': true,
              'restrictionType': 'DURATION',
              'restrictionAmount': 30,
              'restrictionUnit': 'DAY',
              'identityMode': 'CUSTOM_FIELD',
              'identityFieldKey': 'nid',
              'requiresVerifiedPhone': false,
              'configurationRequired': false,
            }))),
      );

      await provider.loadQueueById('queue-1');

      expect(provider.identityFieldKey, 'nid');
      expect(provider.requiresPhoneVerification, isFalse);
      // Nothing to verify, so nothing blocks the join.
      expect(provider.canSubmitJoin, isTrue);
    });

    test('flags a queue that has not been told how to identify customers', () async {
      final provider = _buildProvider(
        MockClient((_) async => _ok(_queueJson(identity: {
              'repeatRestricted': true,
              'restrictionType': null,
              'identityMode': null,
              'identityFieldKey': null,
              'requiresVerifiedPhone': false,
              'configurationRequired': true,
            }))),
      );

      await provider.loadQueueById('queue-1');

      expect(provider.queueNeedsIdentitySetup, isTrue);
    });

    test('an ordinary queue asks for nothing extra', () async {
      final provider = _buildProvider(MockClient((_) async => _ok(_queueJson())));

      await provider.loadQueueById('queue-1');

      expect(provider.requiresPhoneVerification, isFalse);
      expect(provider.queueNeedsIdentitySetup, isFalse);
      expect(provider.identityFieldKey, isNull);
      expect(provider.canSubmitJoin, isTrue);
    });
  });

  group('phone verification', () {
    test('sends a code and then carries the proof into the join', () async {
      String? sentProof;
      final provider = _buildProvider(MockClient((request) async {
        if (request.url.path.contains('/config')) {
          return _ok(_queueJson(identity: _phoneIdentity()));
        }
        if (request.url.path.endsWith('/phone-verification/start')) {
          return _ok({
            'verificationId': 'v1',
            'expiresAt': DateTime.now().add(const Duration(minutes: 5)).toIso8601String(),
            'resendAvailableInSeconds': 60,
          }, 201);
        }
        if (request.url.path.endsWith('/phone-verification/confirm')) {
          return _ok({
            'verificationProof': 'signed-proof',
            'expiresAt': DateTime.now().add(const Duration(minutes: 15)).toIso8601String(),
          });
        }
        if (request.url.path.endsWith('/devices')) {
          return _ok({'id': 'device-1'}, 201);
        }
        sentProof =
            (jsonDecode(request.body) as Map<String, dynamic>)['phoneVerificationProof'] as String?;
        return _ok(_tokenJson(), 201);
      }));
      await provider.loadQueueById('queue-1');
      provider.toggleService('service-1');
      provider.updateFormField('nid', 'A-123');
      provider.updatePhoneNumber('+8801712345678');

      expect(await provider.sendVerificationCode(), isTrue);
      expect(provider.isAwaitingCode, isTrue);
      expect(provider.resendAvailableAt, isNotNull);

      expect(await provider.confirmVerificationCode('123456'), isTrue);
      expect(provider.isPhoneVerified, isTrue);
      expect(provider.canSubmitJoin, isTrue);

      expect(await provider.submitJoin(), isTrue);
      expect(sentProof, 'signed-proof');
    });

    test('refuses to join before the number is verified, without calling the API', () async {
      var joinAttempted = false;
      final provider = _buildProvider(MockClient((request) async {
        if (request.url.path.contains('/config')) {
          return _ok(_queueJson(identity: _phoneIdentity()));
        }
        joinAttempted = true;
        return _ok(_tokenJson(), 201);
      }));
      await provider.loadQueueById('queue-1');
      provider.toggleService('service-1');
      provider.updateFormField('nid', 'A-123');

      final success = await provider.submitJoin();

      expect(success, isFalse);
      expect(joinAttempted, isFalse);
      expect(provider.errorMessage, contains('verify your phone number'));
    });

    test('editing the number throws away the verification it no longer matches', () async {
      final provider = _buildProvider(MockClient((request) async {
        if (request.url.path.contains('/config')) {
          return _ok(_queueJson(identity: _phoneIdentity()));
        }
        if (request.url.path.endsWith('/phone-verification/start')) {
          return _ok({
            'verificationId': 'v1',
            'expiresAt': DateTime.now().add(const Duration(minutes: 5)).toIso8601String(),
            'resendAvailableInSeconds': 60,
          }, 201);
        }
        return _ok({
          'verificationProof': 'signed-proof',
          'expiresAt': DateTime.now().add(const Duration(minutes: 15)).toIso8601String(),
        });
      }));
      await provider.loadQueueById('queue-1');
      provider.updatePhoneNumber('+8801712345678');
      await provider.sendVerificationCode();
      await provider.confirmVerificationCode('123456');
      expect(provider.isPhoneVerified, isTrue);

      provider.updatePhoneNumber('+8801999999999');

      expect(provider.isPhoneVerified, isFalse);
      expect(provider.isAwaitingCode, isFalse);
      expect(provider.canSubmitJoin, isFalse);
    });

    test('explains a wrong code without losing the challenge', () async {
      final provider = _buildProvider(MockClient((request) async {
        if (request.url.path.contains('/config')) {
          return _ok(_queueJson(identity: _phoneIdentity()));
        }
        if (request.url.path.endsWith('/phone-verification/start')) {
          return _ok({
            'verificationId': 'v1',
            'expiresAt': DateTime.now().add(const Duration(minutes: 5)).toIso8601String(),
            'resendAvailableInSeconds': 60,
          }, 201);
        }
        return _err('VERIFICATION_CODE_INCORRECT', 'That code is not correct.');
      }));
      await provider.loadQueueById('queue-1');
      provider.updatePhoneNumber('+8801712345678');
      await provider.sendVerificationCode();

      final confirmed = await provider.confirmVerificationCode('000000');

      expect(confirmed, isFalse);
      expect(provider.verificationError, contains('not correct'));
      // Still the same challenge — the customer can just try again.
      expect(provider.isAwaitingCode, isTrue);
    });

    test('passes the resend cooldown through as the server worded it', () async {
      final provider = _buildProvider(MockClient((request) async {
        if (request.url.path.contains('/config')) {
          return _ok(_queueJson(identity: _phoneIdentity()));
        }
        return _err(
          'VERIFICATION_RESEND_TOO_SOON',
          'Please wait 45 seconds before requesting another code.',
          status: 429,
        );
      }));
      await provider.loadQueueById('queue-1');
      provider.updatePhoneNumber('+8801712345678');

      final sent = await provider.sendVerificationCode();

      expect(sent, isFalse);
      expect(provider.verificationError, contains('45 seconds'));
    });

    test('will not ask for a code with no number typed', () async {
      var startCalled = false;
      final provider = _buildProvider(MockClient((request) async {
        if (request.url.path.contains('/config')) {
          return _ok(_queueJson(identity: _phoneIdentity()));
        }
        startCalled = true;
        return _ok({}, 201);
      }));
      await provider.loadQueueById('queue-1');

      expect(await provider.sendVerificationCode(), isFalse);
      expect(startCalled, isFalse);
      expect(provider.verificationError, contains('international format'));
    });
  });

  group('being turned away', () {
    Future<QueueJoinProvider> providerRejecting(Map<String, dynamic>? details) async {
      final provider = _buildProvider(MockClient((request) async {
        if (request.url.path.contains('/config')) {
          return _ok(_queueJson(identity: {
            'repeatRestricted': true,
            'restrictionType': 'DURATION',
              'restrictionAmount': 30,
              'restrictionUnit': 'DAY',
            'identityMode': 'CUSTOM_FIELD',
            'identityFieldKey': 'nid',
            'requiresVerifiedPhone': false,
            'configurationRequired': false,
          }));
        }
        if (request.url.path.endsWith('/devices')) {
          return _ok({'id': 'device-1'}, 201);
        }
        return _err(
          'REPEAT_VISIT_NOT_ALLOWED',
          'You have already used this queue today. Please come back tomorrow.',
          status: 409,
          details: details,
        );
      }));
      await provider.loadQueueById('queue-1');
      provider.toggleService('service-1');
      provider.updateFormField('nid', 'A-123');
      return provider;
    }

    test('keeps the exact moment the customer may return, and never blames the phone', () async {
      final provider = await providerRejecting({
        'reason': 'ALREADY_USED',
        'restrictionEndsAt': '2026-10-08T04:00:00.000Z',
      });

      expect(await provider.submitJoin(), isFalse);
      expect(provider.restrictionEndsAt, DateTime.parse('2026-10-08T04:00:00.000Z'));
      expect(provider.errorMessage, contains('join again after'));
      expect(provider.errorMessage, isNot(contains('device')));
      expect(provider.errorMessage, isNot(contains('phone')));
    });

    test('falls back to the server wording when there is no return date', () async {
      // A once-ever queue: no future instant makes them eligible, so there is
      // nothing to show on a clock.
      final provider = await providerRejecting({'reason': 'ALREADY_USED'});

      expect(await provider.submitJoin(), isFalse);
      expect(provider.restrictionEndsAt, isNull);
      expect(provider.errorMessage, contains('already used this queue'));
    });

    test('says nothing about a return date when they are simply already in the queue', () async {
      final provider = await providerRejecting({'reason': 'ALREADY_IN_QUEUE'});

      expect(await provider.submitJoin(), isFalse);
      expect(provider.restrictionEndsAt, isNull);
      expect(provider.errorMessage, contains('already used this queue'));
    });

    test('asks the customer to verify again when the proof has expired', () async {
      final provider = _buildProvider(MockClient((request) async {
        if (request.url.path.contains('/config')) {
          return _ok(_queueJson(identity: _phoneIdentity()));
        }
        if (request.url.path.endsWith('/phone-verification/start')) {
          return _ok({
            'verificationId': 'v1',
            'expiresAt': DateTime.now().add(const Duration(minutes: 5)).toIso8601String(),
            'resendAvailableInSeconds': 60,
          }, 201);
        }
        if (request.url.path.endsWith('/phone-verification/confirm')) {
          return _ok({
            'verificationProof': 'stale-proof',
            'expiresAt': DateTime.now().toIso8601String(),
          });
        }
        if (request.url.path.endsWith('/devices')) {
          return _ok({'id': 'device-1'}, 201);
        }
        return _err('PHONE_VERIFICATION_INVALID', 'Expired.', status: 401);
      }));
      await provider.loadQueueById('queue-1');
      provider.toggleService('service-1');
      provider.updateFormField('nid', 'A-123');
      provider.updatePhoneNumber('+8801712345678');
      await provider.sendVerificationCode();
      await provider.confirmVerificationCode('123456');

      expect(await provider.submitJoin(), isFalse);
      expect(provider.errorMessage, contains('verify your number again'));
    });
  });
}
