import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/services/api_client.dart';
import 'package:mobile_app/services/api_exception.dart';

void main() {
  group('ApiClient', () {
    test('get() unwraps the {success, data} envelope', () async {
      final mockClient = MockClient((request) async {
        expect(request.method, 'GET');
        expect(request.url.path, '/api/public/queues/queue-1/config');
        return http.Response(
          jsonEncode({'success': true, 'data': {'id': 'queue-1', 'name': 'Q'}}),
          200,
        );
      });

      final client = ApiClient(httpClient: mockClient, baseUrl: 'http://localhost:4000');
      final data = await client.get('/api/public/queues/queue-1/config');

      expect(data, {'id': 'queue-1', 'name': 'Q'});
    });

    test('post() sends a JSON body and Content-Type header', () async {
      final mockClient = MockClient((request) async {
        expect(request.method, 'POST');
        expect(request.headers['Content-Type'], contains('application/json'));
        expect(jsonDecode(request.body), {'deviceIdentifier': 'device-1'});
        return http.Response(jsonEncode({'success': true, 'data': {'id': 'device-1'}}), 201);
      });

      final client = ApiClient(httpClient: mockClient, baseUrl: 'http://localhost:4000');
      final data = await client.post('/api/devices/register', body: {'deviceIdentifier': 'device-1'});

      expect(data, {'id': 'device-1'});
    });

    test('post() forwards extra headers (e.g. Idempotency-Key)', () async {
      final mockClient = MockClient((request) async {
        expect(request.headers['Idempotency-Key'], 'abc-123');
        return http.Response(jsonEncode({'success': true, 'data': {}}), 201);
      });

      final client = ApiClient(httpClient: mockClient, baseUrl: 'http://localhost:4000');
      await client.post('/api/tokens', headers: {'Idempotency-Key': 'abc-123'});
    });

    test('throws ApiException with the backend error code on a non-2xx response', () async {
      final mockClient = MockClient((request) async {
        return http.Response(
          jsonEncode({
            'success': false,
            'error': {'code': 'QUEUE_NOT_FOUND', 'message': 'Queue not found.'},
          }),
          404,
        );
      });

      final client = ApiClient(httpClient: mockClient, baseUrl: 'http://localhost:4000');

      await expectLater(
        client.get('/api/public/queues/missing/config'),
        throwsA(
          isA<ApiException>()
              .having((e) => e.statusCode, 'statusCode', 404)
              .having((e) => e.code, 'code', 'QUEUE_NOT_FOUND'),
        ),
      );
    });

    test('a malformed error body still produces a safe, non-crashing ApiException', () async {
      final mockClient = MockClient((request) async => http.Response('', 500));
      final client = ApiClient(httpClient: mockClient, baseUrl: 'http://localhost:4000');

      await expectLater(
        client.get('/api/tokens/x'),
        throwsA(isA<ApiException>().having((e) => e.code, 'code', 'UNKNOWN_ERROR')),
      );
    });
  });
}
