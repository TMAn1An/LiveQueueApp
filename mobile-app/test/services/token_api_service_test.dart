import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/models/live_queue_token.dart';
import 'package:mobile_app/services/api_client.dart';
import 'package:mobile_app/services/token_api_service.dart';

Map<String, dynamic> _tokenJson() => {
      'id': 'token-1',
      'queueId': 'queue-1',
      'serviceId': 'service-1',
      'serialNumber': 'A001',
      'status': 'WAITING',
      'formData': {},
      'position': 1,
      'estimatedWaitMinutes': 5,
      'counter': null,
      'createdAt': DateTime.utc(2026, 1, 1).toIso8601String(),
      'calledAt': null,
      'startedAt': null,
      'completedAt': null,
      'skippedAt': null,
    };

void main() {
  group('TokenApiService.createToken', () {
    test('sends the Idempotency-Key header and full request body, parses the response', () async {
      final mockClient = MockClient((request) async {
        expect(request.url.path, '/api/tokens');
        expect(request.headers['Idempotency-Key'], 'idem-key-1');
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['queueId'], 'queue-1');
        expect(body['serviceId'], 'service-1');
        expect(body['deviceIdentifier'], 'device-1');
        expect(body['formData'], {'phone': '555-0100'});
        return http.Response(jsonEncode({'success': true, 'data': _tokenJson()}), 201);
      });

      final service = TokenApiService(ApiClient(httpClient: mockClient, baseUrl: 'http://localhost:4000'));
      final token = await service.createToken(
        queueId: 'queue-1',
        serviceId: 'service-1',
        deviceIdentifier: 'device-1',
        formData: {'phone': '555-0100'},
        idempotencyKey: 'idem-key-1',
      );

      expect(token.id, 'token-1');
      expect(token.status, TokenStatus.waiting);
    });
  });

  group('TokenApiService.getTokenStatus', () {
    test('parses the lightweight status shape', () async {
      final mockClient = MockClient((request) async {
        expect(request.url.path, '/api/tokens/token-1/status');
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {'id': 'token-1', 'status': 'CALLED', 'position': null, 'estimatedWaitMinutes': null},
          }),
          200,
        );
      });

      final service = TokenApiService(ApiClient(httpClient: mockClient, baseUrl: 'http://localhost:4000'));
      final status = await service.getTokenStatus('token-1');

      expect(status.status, TokenStatus.called);
      expect(status.position, isNull);
    });
  });
}
