// Home must be usable while the backend is still being waited on.
//
// A misconfigured build made this concrete rather than theoretical: pointed
// at an unroutable address, every startup request spent its full timeout, and
// what the customer saw was a splash screen for seven seconds. The startup
// path is meant to survive exactly that — only the version gate and local
// preferences are allowed in front of Home — so these tests hold the line by
// making the network permanently unresponsive and then insisting Home works
// anyway.
//
// Deliberately no millisecond assertions: the claim is "does not wait for
// it", which is proved by never letting the request finish at all.

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:mobile_app/providers/active_token_provider.dart';
import 'package:mobile_app/providers/queue_join_provider.dart';
import 'package:mobile_app/repositories/device_repository.dart';
import 'package:mobile_app/repositories/email_verification_repository.dart';
import 'package:mobile_app/repositories/history_repository.dart';
import 'package:mobile_app/repositories/queue_repository.dart';
import 'package:mobile_app/repositories/token_repository.dart';
import 'package:mobile_app/screens/home_screen.dart';
import 'package:mobile_app/services/active_token_storage_service.dart';
import 'package:mobile_app/services/api_client.dart';
import 'package:mobile_app/services/device_api_service.dart';
import 'package:mobile_app/services/device_identity_service.dart';
import 'package:mobile_app/services/email_verification_api_service.dart';
import 'package:mobile_app/services/history_storage_service.dart';
import 'package:mobile_app/services/queue_api_service.dart';
import 'package:mobile_app/services/socket_service.dart';
import 'package:mobile_app/services/token_api_service.dart';

/// Never answers. Any code that awaits it before rendering will hang the
/// test rather than fail it vaguely.
http.Client _neverAnswers() =>
    MockClient((_) => Completer<http.Response>().future);

ActiveTokenProvider _activeTokenProvider(ApiClient apiClient) => ActiveTokenProvider(
      tokenRepository: TokenRepository(
        apiService: TokenApiService(apiClient),
        socketService: SocketService(),
      ),
      storage: ActiveTokenStorageService(),
    );

Widget _homeUnder(ApiClient apiClient, ActiveTokenProvider activeToken) {
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<ActiveTokenProvider>.value(value: activeToken),
      ChangeNotifierProvider<QueueJoinProvider>(
        create: (_) => QueueJoinProvider(
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
          emailVerificationRepository: EmailVerificationRepository(
            apiService: EmailVerificationApiService(apiClient),
          ),
        ),
      ),
    ],
    child: const MaterialApp(home: HomeScreen()),
  );
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('Home renders and is usable while the backend never answers', (tester) async {
    final apiClient = ApiClient(httpClient: _neverAnswers(), baseUrl: 'http://localhost:4000');
    final activeToken = _activeTokenProvider(apiClient);

    await tester.pumpWidget(_homeUnder(apiClient, activeToken));
    await tester.pump();

    expect(find.text('Scan a queue QR code to join'), findsOneWidget);
    expect(find.text('Scan QR Code'), findsOneWidget);
    expect(find.text('Token History'), findsOneWidget);
    expect(find.text('Settings'), findsOneWidget);
  });

  testWidgets('restoring the remembered token never touches the network', (tester) async {
    SharedPreferences.setMockInitialValues({
      'active_token_id': 'token-1',
      'active_token_serial': 'A001',
      'active_token_queue_name': 'Customer Service',
    });
    var requests = 0;
    final apiClient = ApiClient(
      httpClient: MockClient((_) async {
        requests++;
        return http.Response('{}', 200);
      }),
      baseUrl: 'http://localhost:4000',
    );
    final activeToken = _activeTokenProvider(apiClient);

    // Exactly what main() does at startup.
    await activeToken.restore();

    expect(activeToken.hasActiveToken, isTrue);
    expect(requests, 0, reason: 'the pointer is local; the authoritative check happens later');
  });

  testWidgets('a remembered token reaches Home without waiting on the resync', (tester) async {
    SharedPreferences.setMockInitialValues({
      'active_token_id': 'token-1',
      'active_token_serial': 'A001',
      'active_token_queue_name': 'Customer Service',
    });
    final apiClient = ApiClient(httpClient: _neverAnswers(), baseUrl: 'http://localhost:4000');
    final activeToken = _activeTokenProvider(apiClient);
    await activeToken.restore();

    // The resync that would normally follow — started, and never finishing.
    unawaited(activeToken.resync());

    await tester.pumpWidget(_homeUnder(apiClient, activeToken));
    await tester.pump();

    // The way back into the queue is offered off the local pointer alone.
    expect(find.textContaining('Active Token'), findsOneWidget);
    expect(find.textContaining('A001'), findsOneWidget);

    // Let the request's own timeout expire so the test leaves no timer
    // pending. That it takes this long to finish is the point: Home was
    // usable throughout.
    await tester.pump(const Duration(seconds: 13));
    expect(activeToken.hasActiveToken, isTrue);
  });

  testWidgets('an unreachable backend does not forget the remembered token', (tester) async {
    SharedPreferences.setMockInitialValues({
      'active_token_id': 'token-1',
      'active_token_serial': 'A001',
      'active_token_queue_name': 'Customer Service',
    });
    final apiClient = ApiClient(
      httpClient: MockClient((_) async => throw const _Unreachable()),
      baseUrl: 'http://localhost:4000',
    );
    final activeToken = _activeTokenProvider(apiClient);
    await activeToken.restore();

    expect(await activeToken.resync(), isNull);
    expect(activeToken.hasActiveToken, isTrue,
        reason: 'not reaching the server says nothing about whether the customer is still queued');

    await tester.pumpWidget(_homeUnder(apiClient, activeToken));
    await tester.pump();
    expect(find.textContaining('Active Token'), findsOneWidget);
  });
}

class _Unreachable implements Exception {
  const _Unreachable();
}
