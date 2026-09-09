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

/// A running token outlives the screen that was showing it (ADR-036), and —
/// as of the V2 Product Completion checkpoint — the same installation can
/// hold one of these per queue at once. Joining a second queue must never
/// erase the first; only the backend, resynced per token, decides a given
/// token's fate.
///
/// Navigation must never end a visit, and a remembered token is only ever a
/// pointer — the backend decides whether it is still live.

Map<String, dynamic> _tokenJson({
  String id = 'token-1',
  String queueId = 'queue-1',
  String status = 'WAITING',
  String serial = 'A023',
}) =>
    {
      'id': id,
      'queueId': queueId,
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

/// Routes each mocked lookup by the tokenId in the URL path, so a test can
/// give different tokens genuinely independent server-side outcomes — the
/// only way to prove one token's failure never touches another's.
typedef _ResponseForToken = http.Response Function(String tokenId);

ActiveTokenProvider _build(
  http.Client client, {
  void Function(LiveQueueToken token, {required String queueName})? onTokenStatusChanged,
}) {
  final apiClient = ApiClient(httpClient: client, baseUrl: 'http://localhost:4000');
  return ActiveTokenProvider(
    tokenRepository: TokenRepository(
      apiService: TokenApiService(apiClient),
      socketService: SocketService(),
    ),
    storage: ActiveTokenStorageService(),
    onTokenStatusChanged: onTokenStatusChanged,
  );
}

http.Client _byTokenId(_ResponseForToken respond) {
  return MockClient((request) async {
    final tokenId = request.url.pathSegments.firstWhere(
      (s) => s.startsWith('token-') || s == 'other',
      orElse: () => '',
    );
    return respond(tokenId);
  });
}

LiveQueueToken _token({String id = 'token-1', String queueId = 'queue-1', String status = 'WAITING'}) =>
    LiveQueueToken.fromJson(_tokenJson(id: id, queueId: queueId, status: status));

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('starts with nothing remembered', () async {
    final provider = _build(MockClient((_) async => _ok(_tokenJson())));

    await provider.restore();

    expect(provider.hasActiveToken, isFalse);
    expect(provider.activeTokens, isEmpty);
  });

  test('remembers a token and survives a fresh provider — an app restart', () async {
    final first = _build(MockClient((_) async => _ok(_tokenJson())));
    await first.remember(_token(), queueName: 'Pharmacy');

    // A new provider over the same storage is what a cold start looks like.
    final second = _build(MockClient((_) async => _ok(_tokenJson())));
    await second.restore();

    expect(second.hasActiveToken, isTrue);
    expect(second.activeTokens, hasLength(1));
    expect(second.activeTokens.single.tokenId, 'token-1');
    expect(second.activeTokens.single.serialNumber, 'A023');
    expect(second.activeTokens.single.queueName, 'Pharmacy');
  });

  group('multiple queues', () {
    test('joining Queue B does not remove Queue A', () async {
      final provider = _build(MockClient((_) async => _ok(_tokenJson())));
      await provider.remember(
        _token(id: 'token-a', queueId: 'queue-a'),
        queueName: 'Pharmacy',
      );
      await provider.remember(
        _token(id: 'token-b', queueId: 'queue-b', status: 'WAITING'),
        queueName: 'Billing',
      );

      expect(provider.activeTokens.map((t) => t.tokenId), containsAll(['token-a', 'token-b']));
      expect(provider.activeTokens, hasLength(2));
    });

    test('remembering the same token id again upserts rather than duplicating', () async {
      final provider = _build(MockClient((_) async => _ok(_tokenJson())));
      await provider.remember(_token(status: 'WAITING'), queueName: 'Pharmacy');
      await provider.remember(_token(status: 'WAITING'), queueName: 'Pharmacy');

      expect(provider.activeTokens, hasLength(1));
    });

    test('Queue A completing removes only Queue A, Queue B remains', () async {
      final provider = _build(_byTokenId((tokenId) {
        if (tokenId == 'token-a') return _ok(_tokenJson(id: 'token-a', status: 'COMPLETED'));
        return _ok(_tokenJson(id: 'token-b', queueId: 'queue-b', status: 'WAITING'));
      }));
      await provider.remember(_token(id: 'token-a', queueId: 'queue-a'), queueName: 'Pharmacy');
      await provider.remember(_token(id: 'token-b', queueId: 'queue-b'), queueName: 'Billing');

      await provider.resyncOne('token-a');

      expect(provider.summaryFor('token-a'), isNull);
      expect(provider.summaryFor('token-b'), isNotNull);
    });

    test('Queue B changing status does not disturb Queue C', () async {
      final provider = _build(_byTokenId((tokenId) {
        if (tokenId == 'token-b') return _ok(_tokenJson(id: 'token-b', status: 'CALLED'));
        return _ok(_tokenJson(id: 'token-c', queueId: 'queue-c', status: 'WAITING'));
      }));
      await provider.remember(_token(id: 'token-b', queueId: 'queue-b'), queueName: 'Billing');
      await provider.remember(_token(id: 'token-c', queueId: 'queue-c'), queueName: 'Clinic');

      await provider.resyncOne('token-b');

      expect(provider.summaryFor('token-b')!.status, TokenStatus.called);
      expect(provider.summaryFor('token-c')!.status, TokenStatus.waiting);
    });

    test('one token 404ing during resyncAll never affects another token', () async {
      final provider = _build(_byTokenId((tokenId) {
        if (tokenId == 'token-a') return _err(404, 'TOKEN_NOT_FOUND');
        return _ok(_tokenJson(id: 'token-b', queueId: 'queue-b', status: 'WAITING'));
      }));
      await provider.remember(_token(id: 'token-a', queueId: 'queue-a'), queueName: 'Pharmacy');
      await provider.remember(_token(id: 'token-b', queueId: 'queue-b'), queueName: 'Billing');

      await provider.resyncAll();

      expect(provider.summaryFor('token-a'), isNull, reason: 'stale token removed on 404');
      expect(provider.summaryFor('token-b'), isNotNull, reason: 'unaffected by the other lookup');
    });

    test('a network failure on one token during resyncAll keeps it, and does not touch others',
        () async {
      final provider = _build(_byTokenId((tokenId) {
        if (tokenId == 'token-a') return _err(503, 'UNAVAILABLE');
        return _ok(_tokenJson(id: 'token-b', queueId: 'queue-b', status: 'CALLED'));
      }));
      await provider.remember(_token(id: 'token-a', queueId: 'queue-a'), queueName: 'Pharmacy');
      await provider.remember(_token(id: 'token-b', queueId: 'queue-b'), queueName: 'Billing');

      await provider.resyncAll();

      expect(provider.summaryFor('token-a'), isNotNull, reason: 'kept despite the network error');
      expect(provider.summaryFor('token-b')!.status, TokenStatus.called);
    });
  });

  test('resyncOne returns the token while the backend still says it is live', () async {
    final provider = _build(MockClient((_) async => _ok(_tokenJson())));
    await provider.remember(_token(), queueName: 'Pharmacy');

    final token = await provider.resyncOne('token-1');

    expect(token, isNotNull);
    expect(token!.status, TokenStatus.waiting);
    expect(provider.hasActiveToken, isTrue);
  });

  test('never trusts a stale local status over the server', () async {
    // Locally it was WAITING when we last looked; the server says it is done.
    final provider = _build(MockClient((_) async => _ok(_tokenJson(status: 'COMPLETED'))));
    await provider.remember(_token(), queueName: 'Pharmacy');

    final token = await provider.resyncOne('token-1');

    expect(token, isNull);
    expect(provider.hasActiveToken, isFalse);
  });

  test('forgets a token the server no longer has', () async {
    final provider = _build(MockClient((_) async => _err(404, 'TOKEN_NOT_FOUND')));
    await provider.remember(_token(), queueName: 'Pharmacy');

    await provider.resyncOne('token-1');

    expect(provider.hasActiveToken, isFalse);
  });

  test('keeps the token when the server simply cannot be reached', () async {
    final provider = _build(MockClient((_) async => _err(503, 'UNAVAILABLE')));
    await provider.remember(_token(), queueName: 'Pharmacy');

    final token = await provider.resyncOne('token-1');

    // A dropped connection says nothing about whether they are still in the
    // queue — forgetting the token here would be the worst possible reading.
    expect(token, isNull);
    expect(provider.hasActiveToken, isTrue);
  });

  group('SKIPPED — recoverable, not removed', () {
    test('a resync that finds SKIPPED keeps the token, updating its status', () async {
      final provider = _build(MockClient((_) async => _ok(_tokenJson(status: 'SKIPPED'))));
      await provider.remember(_token(), queueName: 'Pharmacy');

      final token = await provider.resyncOne('token-1');

      // SKIPPED is not "isActive" — recall/live-tracking is a separate
      // concern from "is it still worth remembering" — but it must not be
      // dropped from the collection: staff can still recall it.
      expect(token, isNotNull);
      expect(token!.status, TokenStatus.skipped);
      expect(provider.summaryFor('token-1'), isNotNull);
      expect(provider.summaryFor('token-1')!.status, TokenStatus.skipped);
    });

    test('syncFromTracked keeps a SKIPPED token instead of removing it', () async {
      final provider = _build(MockClient((_) async => _ok(_tokenJson())));
      await provider.remember(_token(), queueName: 'Pharmacy');

      await provider.syncFromTracked(_token(status: 'SKIPPED'));

      expect(provider.hasActiveToken, isTrue);
      expect(provider.summaryFor('token-1')!.status, TokenStatus.skipped);
    });

    test('a recall back to CALLED after SKIPPED updates the same entry', () async {
      final provider = _build(MockClient((_) async => _ok(_tokenJson(status: 'CALLED'))));
      await provider.remember(_token(status: 'SKIPPED'), queueName: 'Pharmacy');

      await provider.resyncOne('token-1');

      expect(provider.summaryFor('token-1')!.status, TokenStatus.called);
    });

    test('COMPLETED after SKIPPED does finally remove it', () async {
      final provider = _build(MockClient((_) async => _ok(_tokenJson(status: 'COMPLETED'))));
      await provider.remember(_token(status: 'SKIPPED'), queueName: 'Pharmacy');

      await provider.resyncOne('token-1');

      expect(provider.summaryFor('token-1'), isNull);
    });
  });

  test('drops the pointer once the tracked token settles', () async {
    final provider = _build(MockClient((_) async => _ok(_tokenJson())));
    await provider.remember(_token(), queueName: 'Pharmacy');

    await provider.syncFromTracked(_token(status: 'COMPLETED'));

    expect(provider.hasActiveToken, isFalse);
  });

  test('ignores a settled token that is not remembered at all', () async {
    final provider = _build(MockClient((_) async => _ok(_tokenJson())));
    await provider.remember(_token(), queueName: 'Pharmacy');

    final other = LiveQueueToken.fromJson({..._tokenJson(status: 'COMPLETED'), 'id': 'other'});
    await provider.syncFromTracked(other);

    // "token-1" is unaffected; "other" was never in the collection to begin
    // with, so there is nothing to remove and nothing else to disturb.
    expect(provider.hasActiveToken, isTrue);
    expect(provider.summaryFor('token-1'), isNotNull);
  });

  test('removing one remembered token by id leaves every other one untouched', () async {
    final provider = _build(MockClient((_) async => _ok(_tokenJson())));
    await provider.remember(_token(id: 'token-a', queueId: 'queue-a'), queueName: 'Pharmacy');
    await provider.remember(_token(id: 'token-b', queueId: 'queue-b'), queueName: 'Billing');

    await provider.remove('token-a');

    expect(provider.summaryFor('token-a'), isNull);
    expect(provider.summaryFor('token-b'), isNotNull);

    final reopened = _build(MockClient((_) async => _ok(_tokenJson())));
    await reopened.restore();
    expect(reopened.summaryFor('token-a'), isNull);
    expect(reopened.summaryFor('token-b'), isNotNull);
  });

  test('notifies the given callback exactly when a resync finds a genuine status change',
      () async {
    final changes = <TokenStatus>[];
    final provider = _build(
      MockClient((_) async => _ok(_tokenJson(status: 'CALLED'))),
      onTokenStatusChanged: (token, {required queueName}) => changes.add(token.status),
    );
    await provider.remember(_token(status: 'WAITING'), queueName: 'Pharmacy');

    await provider.resyncOne('token-1');
    // Same status again — must not fire a second time for no real change.
    await provider.resyncOne('token-1');

    expect(changes, [TokenStatus.called]);
  });
}
