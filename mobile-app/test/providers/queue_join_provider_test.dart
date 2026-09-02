import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/providers/queue_join_provider.dart';
import 'package:mobile_app/repositories/device_repository.dart';
import 'package:mobile_app/repositories/history_repository.dart';
import 'package:mobile_app/repositories/queue_repository.dart';
import 'package:mobile_app/repositories/token_repository.dart';
import 'package:mobile_app/services/api_client.dart';
import 'package:mobile_app/services/device_api_service.dart';
import 'package:mobile_app/services/device_identity_service.dart';
import 'package:mobile_app/services/history_storage_service.dart';
import 'package:mobile_app/services/queue_api_service.dart';
import 'package:mobile_app/services/socket_service.dart';
import 'package:mobile_app/services/token_api_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

Map<String, dynamic> _queueJson({String status = 'ACTIVE'}) => {
      'id': 'queue-1',
      'name': 'Customer Service',
      'description': null,
      'status': status,
      'clientTerminology': null,
      'services': [
        {'id': 'service-1', 'serviceName': 'General Inquiry', 'description': null, 'durationMinutes': 5},
        {'id': 'service-2', 'serviceName': 'Document Check', 'description': null, 'durationMinutes': 7},
      ],
      'formFields': [
        {
          'id': 'field-1',
          'key': 'fullName',
          'label': 'Full Name',
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
      'formData': {'fullName': 'Jane Doe'},
      'position': 1,
      'estimatedWaitMinutes': 5,
      'counter': null,
      'createdAt': DateTime.utc(2026, 1, 1).toIso8601String(),
      'calledAt': null,
      'startedAt': null,
      'completedAt': null,
      'skippedAt': null,
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
  );
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('loadQueueById', () {
    test('populates queueConfig on success', () async {
      final mockClient = MockClient((request) async {
        return http.Response(jsonEncode({'success': true, 'data': _queueJson()}), 200);
      });
      final provider = _buildProvider(mockClient);

      await provider.loadQueueById('queue-1');

      expect(provider.queueConfig, isNotNull);
      expect(provider.queueConfig!.name, 'Customer Service');
      expect(provider.errorMessage, isNull);
      expect(provider.isLoadingQueue, isFalse);
    });

    test('sets a user-friendly errorMessage for QUEUE_NOT_FOUND', () async {
      final mockClient = MockClient((request) async {
        return http.Response(
          jsonEncode({
            'success': false,
            'error': {'code': 'QUEUE_NOT_FOUND', 'message': 'Queue not found.'},
          }),
          404,
        );
      });
      final provider = _buildProvider(mockClient);

      await provider.loadQueueById('missing-queue');

      expect(provider.queueConfig, isNull);
      expect(provider.errorMessage, contains('could not be found'));
    });
  });

  group('submitJoin', () {
    test('does not call the token-creation API and reports formErrors when a required field is missing', () async {
      var tokenCreateCalled = false;
      final mockClient = MockClient((request) async {
        if (request.url.path.contains('/config')) {
          return http.Response(jsonEncode({'success': true, 'data': _queueJson()}), 200);
        }
        tokenCreateCalled = true;
        return http.Response(jsonEncode({'success': true, 'data': _tokenJson()}), 201);
      });
      final provider = _buildProvider(mockClient);
      await provider.loadQueueById('queue-1');
      provider.toggleService(provider.queueConfig!.services.first.id);

      final success = await provider.submitJoin();

      expect(success, isFalse);
      expect(tokenCreateCalled, isFalse);
      expect(provider.formErrors, contains('fullName'));
    });

    test('creates a token and records history on success', () async {
      final mockClient = MockClient((request) async {
        if (request.url.path.contains('/config')) {
          return http.Response(jsonEncode({'success': true, 'data': _queueJson()}), 200);
        }
        if (request.url.path == '/api/devices/register') {
          return http.Response(jsonEncode({'success': true, 'data': {'id': 'device-1'}}), 201);
        }
        return http.Response(jsonEncode({'success': true, 'data': _tokenJson()}), 201);
      });
      final provider = _buildProvider(mockClient);
      await provider.loadQueueById('queue-1');
      provider.toggleService(provider.queueConfig!.services.first.id);
      provider.updateFormField('fullName', 'Jane Doe');

      final success = await provider.submitJoin();

      expect(success, isTrue);
      expect(provider.createdToken, isNotNull);
      expect(provider.createdToken!.serialNumber, 'A001');
      expect(provider.errorMessage, isNull);

      final history = await HistoryRepository(storageService: HistoryStorageService()).getHistory();
      expect(history, hasLength(1));
      expect(history.single.serialNumber, 'A001');
      expect(history.single.queueName, 'Customer Service');
    });

    test('V2 Checkpoint 5: selecting multiple services sends all of them and sums the displayed duration', () async {
      Map<String, dynamic>? capturedBody;
      final mockClient = MockClient((request) async {
        if (request.url.path.contains('/config')) {
          return http.Response(jsonEncode({'success': true, 'data': _queueJson()}), 200);
        }
        if (request.url.path == '/api/devices/register') {
          return http.Response(jsonEncode({'success': true, 'data': {'id': 'device-1'}}), 201);
        }
        capturedBody = jsonDecode(request.body) as Map<String, dynamic>;
        return http.Response(jsonEncode({'success': true, 'data': _tokenJson()}), 201);
      });
      final provider = _buildProvider(mockClient);
      await provider.loadQueueById('queue-1');

      provider.toggleService('service-1');
      provider.toggleService('service-2');
      expect(provider.selectedServiceIds, {'service-1', 'service-2'});
      expect(provider.selectedTotalDurationMinutes, 12); // 5 + 7

      // Toggling one back off removes only that one.
      provider.toggleService('service-1');
      expect(provider.selectedServiceIds, {'service-2'});
      provider.toggleService('service-1'); // back on for the actual submit below
      provider.updateFormField('fullName', 'Jane Doe');

      final success = await provider.submitJoin();

      expect(success, isTrue);
      expect(capturedBody, isNotNull);
      expect(Set<String>.from(capturedBody!['serviceIds'] as List), {'service-1', 'service-2'});
    });

    test('maps QUEUE_NOT_ACTIVE to a user-friendly message', () async {
      final mockClient = MockClient((request) async {
        if (request.url.path.contains('/config')) {
          return http.Response(jsonEncode({'success': true, 'data': _queueJson()}), 200);
        }
        if (request.url.path == '/api/devices/register') {
          return http.Response(jsonEncode({'success': true, 'data': {'id': 'device-1'}}), 201);
        }
        return http.Response(
          jsonEncode({
            'success': false,
            'error': {'code': 'QUEUE_NOT_ACTIVE', 'message': 'raw backend message'},
          }),
          409,
        );
      });
      final provider = _buildProvider(mockClient);
      await provider.loadQueueById('queue-1');
      provider.toggleService(provider.queueConfig!.services.first.id);
      provider.updateFormField('fullName', 'Jane Doe');

      final success = await provider.submitJoin();

      expect(success, isFalse);
      expect(provider.errorMessage, 'This queue is not currently accepting new customers.');
      expect(provider.createdToken, isNull);
    });
  });

  group('idempotency key stability across retries', () {
    /// Captures the `Idempotency-Key` header of every POST /api/tokens
    /// request. The Nth entry in `attempts` fails (simulates the request
    /// reaching the server but the response being lost, or any other
    /// transient failure); every entry after that succeeds.
    ({http.Client client, List<String?> capturedKeys}) buildFailThenSucceedClient({
      required int failCount,
    }) {
      final capturedKeys = <String?>[];
      var tokenCallCount = 0;
      final client = MockClient((request) async {
        if (request.url.path.contains('/config')) {
          return http.Response(jsonEncode({'success': true, 'data': _queueJson()}), 200);
        }
        if (request.url.path == '/api/devices/register') {
          return http.Response(jsonEncode({'success': true, 'data': {'id': 'device-1'}}), 201);
        }
        // POST /api/tokens
        capturedKeys.add(request.headers['Idempotency-Key']);
        tokenCallCount++;
        if (tokenCallCount <= failCount) {
          return http.Response(
            jsonEncode({
              'success': false,
              'error': {'code': 'INTERNAL_ERROR', 'message': 'simulated transient failure'},
            }),
            500,
          );
        }
        return http.Response(jsonEncode({'success': true, 'data': _tokenJson()}), 201);
      });
      return (client: client, capturedKeys: capturedKeys);
    }

    test('the first submit generates exactly one idempotency key', () async {
      final built = buildFailThenSucceedClient(failCount: 0);
      final provider = _buildProvider(built.client);
      await provider.loadQueueById('queue-1');
      provider.toggleService(provider.queueConfig!.services.first.id);
      provider.updateFormField('fullName', 'Jane Doe');

      final success = await provider.submitJoin();

      expect(success, isTrue);
      expect(built.capturedKeys, hasLength(1));
      expect(built.capturedKeys.single, isNotNull);
      expect(built.capturedKeys.single, isNotEmpty);
    });

    test('a failed submission retains the key, and retrying reuses exactly the same key', () async {
      final built = buildFailThenSucceedClient(failCount: 1);
      final provider = _buildProvider(built.client);
      await provider.loadQueueById('queue-1');
      provider.toggleService(provider.queueConfig!.services.first.id);
      provider.updateFormField('fullName', 'Jane Doe');

      final firstAttempt = await provider.submitJoin();
      expect(firstAttempt, isFalse); // simulated transient failure
      expect(provider.errorMessage, isNotNull);

      final secondAttempt = await provider.submitJoin();
      expect(secondAttempt, isTrue); // retry succeeds

      // Exactly two token-creation calls were made (no silently-dropped or
      // duplicated attempts), and — the actual regression being guarded
      // against — both used the identical Idempotency-Key value: the retry
      // never generated a second UUID.
      expect(built.capturedKeys, hasLength(2));
      expect(built.capturedKeys[0], isNotNull);
      expect(built.capturedKeys[1], built.capturedKeys[0]);
    });

    test('a successful submission clears the pending key, so a later new attempt uses a fresh one', () async {
      final built = buildFailThenSucceedClient(failCount: 0);
      final provider = _buildProvider(built.client);
      await provider.loadQueueById('queue-1');
      provider.toggleService(provider.queueConfig!.services.first.id);
      provider.updateFormField('fullName', 'Jane Doe');

      final success = await provider.submitJoin();
      expect(success, isTrue);
      final firstKey = built.capturedKeys.single;

      // A second, wholly independent join (e.g. the customer joins another
      // queue later) must not reuse the now-completed attempt's key.
      provider.reset();
      await provider.loadQueueById('queue-1');
      provider.toggleService(provider.queueConfig!.services.first.id);
      provider.updateFormField('fullName', 'Jane Doe');
      final secondSuccess = await provider.submitJoin();

      expect(secondSuccess, isTrue);
      expect(built.capturedKeys, hasLength(2));
      expect(built.capturedKeys[1], isNot(firstKey));
    });

    test('reset() before any retry still yields a fresh key on the next attempt', () async {
      // Both calls fail here — the point of this test is purely to compare
      // the two captured keys, independent of whether either call succeeds.
      final built = buildFailThenSucceedClient(failCount: 2);
      final provider = _buildProvider(built.client);
      await provider.loadQueueById('queue-1');
      provider.toggleService(provider.queueConfig!.services.first.id);
      provider.updateFormField('fullName', 'Jane Doe');

      final failedAttempt = await provider.submitJoin();
      expect(failedAttempt, isFalse);

      // Explicitly cancelling the in-progress attempt (not just retrying)
      // must start a genuinely new attempt with a new key next time.
      provider.reset();
      await provider.loadQueueById('queue-1');
      provider.toggleService(provider.queueConfig!.services.first.id);
      provider.updateFormField('fullName', 'Jane Doe');
      final freshAttempt = await provider.submitJoin();

      expect(freshAttempt, isFalse); // failCount:2 covers both calls
      expect(built.capturedKeys, hasLength(2));
      expect(built.capturedKeys[1], isNot(built.capturedKeys[0]));
    });
  });

  group('reset', () {
    test('clears all join-flow state', () async {
      final mockClient = MockClient((request) async {
        return http.Response(jsonEncode({'success': true, 'data': _queueJson()}), 200);
      });
      final provider = _buildProvider(mockClient);
      await provider.loadQueueById('queue-1');
      provider.toggleService(provider.queueConfig!.services.first.id);
      provider.updateFormField('fullName', 'Jane Doe');

      provider.reset();

      expect(provider.queueConfig, isNull);
      expect(provider.selectedServiceIds, isEmpty);
      expect(provider.formData, isEmpty);
      expect(provider.createdToken, isNull);
      expect(provider.errorMessage, isNull);
    });
  });
}
