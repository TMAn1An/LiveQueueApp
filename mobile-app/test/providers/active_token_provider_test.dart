import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/models/live_queue_token.dart';
import 'package:mobile_app/providers/active_token_provider.dart';
import 'package:mobile_app/repositories/token_repository.dart';
import 'package:mobile_app/services/active_token_storage_service.dart';
import 'package:mobile_app/services/api_client.dart';
import 'package:mobile_app/services/socket_service.dart';
import 'package:mobile_app/services/token_api_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// A running token outlives the screen that was showing it (ADR-036).
///
/// Navigation must never end a visit, and a remembered token is only ever a
/// pointer — the backend decides whether it is still live.

Map<String, dynamic> _tokenJson({String status = 'WAITING', String serial = 'A023'}) => {
      'id': 'token-1',
      'queueId': 'queue-1',
      'serviceId': 'service-1',
      'serialNumber': serial,
      'status': status,
      'formData': <String, dynamic>{},
      'position': 3,
      'estimatedWaitMinutes': 12,
      'counter': null,
      'createdAt': DateTime.utc(2026, 9, 9).toIso8601String(),
      'calledAt': null,
      'startedAt': null,
      'completedAt': null,
      'skippedAt': null,
    };

http.Response _ok(Map<String, dynamic> data) =>
    http.Response(jsonEncode({'success': true, 'data': data}), 200);

http.Response _err(int status, String code) => http.Response(
      jsonEncode({
        'success': false,
        'error': {'code': code, 'message': 'nope'},
      }),
      status,
    );

ActiveTokenProvider _build(http.Client client) {
  final apiClient = ApiClient(httpClient: client, baseUrl: 'http://localhost:4000');
  return ActiveTokenProvider(
    tokenRepository: TokenRepository(
      apiService: TokenApiService(apiClient),
      socketService: SocketService(),
    ),
    storage: ActiveTokenStorageService(),
  );
}

LiveQueueToken _token({String status = 'WAITING'}) =>
    LiveQueueToken.fromJson(_tokenJson(status: status));

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('starts with nothing remembered', () async {
    final provider = _build(MockClient((_) async => _ok(_tokenJson())));

    await provider.restore();

    expect(provider.hasActiveToken, isFalse);
    expect(provider.activeToken, isNull);
  });

  test('remembers a token and survives a fresh provider — an app restart', () async {
    final first = _build(MockClient((_) async => _ok(_tokenJson())));
    await first.remember(_token(), queueName: 'Pharmacy');

    // A new provider over the same storage is what a cold start looks like.
    final second = _build(MockClient((_) async => _ok(_tokenJson())));
    await second.restore();

    expect(second.hasActiveToken, isTrue);
    expect(second.activeToken!.tokenId, 'token-1');
    expect(second.activeToken!.serialNumber, 'A023');
    expect(second.activeToken!.queueName, 'Pharmacy');
  });

  test('resync returns the token while the backend still says it is live', () async {
    final provider = _build(MockClient((_) async => _ok(_tokenJson())));
    await provider.remember(_token(), queueName: 'Pharmacy');

    final token = await provider.resync();

    expect(token, isNotNull);
    expect(token!.status, TokenStatus.waiting);
    expect(provider.hasActiveToken, isTrue);
  });

  test('never trusts a stale local status over the server', () async {
    // Locally it was WAITING when we last looked; the server says it is done.
    final provider = _build(MockClient((_) async => _ok(_tokenJson(status: 'COMPLETED'))));
    await provider.remember(_token(), queueName: 'Pharmacy');

    final token = await provider.resync();

    expect(token, isNull);
    expect(provider.hasActiveToken, isFalse);
  });

  test('forgets a token the server no longer has', () async {
    final provider = _build(MockClient((_) async => _err(404, 'TOKEN_NOT_FOUND')));
    await provider.remember(_token(), queueName: 'Pharmacy');

    await provider.resync();

    expect(provider.hasActiveToken, isFalse);
  });

  test('keeps the token when the server simply cannot be reached', () async {
    final provider = _build(MockClient((_) async => _err(503, 'UNAVAILABLE')));
    await provider.remember(_token(), queueName: 'Pharmacy');

    final token = await provider.resync();

    // A dropped connection says nothing about whether they are still in the
    // queue — forgetting the token here would be the worst possible reading.
    expect(token, isNull);
    expect(provider.hasActiveToken, isTrue);
  });

  test('drops the pointer once the tracked token settles', () async {
    final provider = _build(MockClient((_) async => _ok(_tokenJson())));
    await provider.remember(_token(), queueName: 'Pharmacy');

    await provider.syncFromTracked(_token(status: 'COMPLETED'));

    expect(provider.hasActiveToken, isFalse);
  });

  test('ignores a settled token that is not the remembered one', () async {
    final provider = _build(MockClient((_) async => _ok(_tokenJson())));
    await provider.remember(_token(), queueName: 'Pharmacy');

    final other = LiveQueueToken.fromJson({..._tokenJson(status: 'COMPLETED'), 'id': 'other'});
    await provider.syncFromTracked(other);

    expect(provider.hasActiveToken, isTrue);
  });

  test('an explicit clear removes it', () async {
    final provider = _build(MockClient((_) async => _ok(_tokenJson())));
    await provider.remember(_token(), queueName: 'Pharmacy');

    await provider.clear();

    expect(provider.hasActiveToken, isFalse);
    final reopened = _build(MockClient((_) async => _ok(_tokenJson())));
    await reopened.restore();
    expect(reopened.hasActiveToken, isFalse);
  });
}
