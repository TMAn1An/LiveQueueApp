import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/models/live_queue_token.dart';
import 'package:mobile_app/providers/token_tracking_provider.dart';
import 'package:mobile_app/repositories/device_repository.dart';
import 'package:mobile_app/repositories/history_repository.dart';
import 'package:mobile_app/repositories/queue_repository.dart';
import 'package:mobile_app/repositories/token_repository.dart';
import 'package:mobile_app/screens/live_tracking_screen.dart';
import 'package:mobile_app/screens/queue_details_screen.dart';
import 'package:mobile_app/services/api_client.dart';
import 'package:mobile_app/services/device_api_service.dart';
import 'package:mobile_app/services/device_identity_service.dart';
import 'package:mobile_app/services/fcm_service.dart';
import 'package:mobile_app/services/history_storage_service.dart';
import 'package:mobile_app/services/notification_service.dart';
import 'package:mobile_app/services/queue_api_service.dart';
import 'package:mobile_app/services/socket_service.dart';
import 'package:mobile_app/services/token_api_service.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// ADR-063: Queue Details is no longer a step on the way into a queue. It is
/// a read-only page a customer opens from Live Tracking once they hold a
/// token, loaded fresh by queue id.

Map<String, dynamic> _queueJson([Map<String, dynamic> overrides = const {}]) => {
      'id': 'queue-1',
      'name': 'Customer Service',
      'description': 'Ground floor, desk 3',
      'status': 'ACTIVE',
      'clientTerminology': null,
      'services': [
        {'id': 'service-1', 'serviceName': 'General Inquiry', 'description': null, 'durationMinutes': 5},
        {'id': 'service-2', 'serviceName': 'Document Check', 'description': 'Bring ID', 'durationMinutes': 7},
      ],
      'formFields': <Map<String, dynamic>>[],
      ...overrides,
    };

http.Response _ok(Map<String, dynamic> data) =>
    http.Response(jsonEncode({'success': true, 'data': data}), 200);

QueueRepository _repository(Future<http.Response> Function(http.Request) handler) {
  return QueueRepository(
    apiService: QueueApiService(
      ApiClient(httpClient: MockClient(handler), baseUrl: 'http://localhost:4000'),
    ),
  );
}

Future<void> _pumpDetails(WidgetTester tester, QueueRepository repository) async {
  await tester.pumpWidget(
    Provider<QueueRepository>.value(
      value: repository,
      child: const MaterialApp(home: QueueDetailsScreen(queueId: 'queue-1')),
    ),
  );
  await tester.pumpAndSettle();
}

/// Live Tracking with a token already in hand and no live session behind it.
class _FakeTracking extends TokenTrackingProvider {
  _FakeTracking(TokenStatus status)
      : super(
          tokenRepository: TokenRepository(
            apiService: TokenApiService(ApiClient(baseUrl: 'http://localhost:4000')),
            socketService: SocketService(),
          ),
          deviceRepository: DeviceRepository(
            identityService: DeviceIdentityService(),
            apiService: DeviceApiService(ApiClient(baseUrl: 'http://localhost:4000')),
          ),
          historyRepository: HistoryRepository(storageService: HistoryStorageService()),
          notificationService: NotificationService(),
          fcmService: FcmService(notificationService: NotificationService()),
        ) {
    token = LiveQueueToken(
      id: 'token-1',
      queueId: 'queue-1',
      serviceId: 'service-1',
      serialNumber: 'A007',
      status: status,
      formData: const {},
      position: 2,
      estimatedWaitMinutes: 12,
      estimatedReadyAt: DateTime.now().add(const Duration(minutes: 12)),
      counter: null,
      createdAt: DateTime.utc(2026, 1, 1),
    );
    isConnected = true;
  }
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('what the page shows', () {
    testWidgets('the queue, its status and its services — read from the backend by id', (tester) async {
      final requested = <String>[];
      await _pumpDetails(
        tester,
        _repository((request) async {
          requested.add(request.url.path);
          return _ok(_queueJson());
        }),
      );

      expect(requested, ['/api/public/queues/queue-1/config']);
      expect(find.text('Queue Details'), findsOneWidget);
      expect(find.text('Customer Service'), findsOneWidget);
      expect(find.text('Ground floor, desk 3'), findsOneWidget);
      expect(find.text('Open'), findsOneWidget);
      expect(find.text('General Inquiry'), findsOneWidget);
      expect(find.text('Document Check'), findsOneWidget);
      expect(find.text('Bring ID'), findsOneWidget);
      expect(find.text('7 min'), findsOneWidget);
      expect(find.text('One or several services can be chosen in one visit.'), findsOneWidget);
    });

    testWidgets('it is not a step in a join: nothing to continue to', (tester) async {
      await _pumpDetails(tester, _repository((_) async => _ok(_queueJson())));

      expect(find.text('Continue'), findsNothing);
      expect(find.byType(FilledButton), findsNothing);
    });

    testWidgets("today's hours and the repeat-visit rule", (tester) async {
      await _pumpDetails(
        tester,
        _repository(
          (_) async => _ok(
            _queueJson({
              'allowMultipleServices': false,
              'identity': {'repeatRestricted': true, 'restrictionType': 'ONCE_EVER'},
              'schedule': {
                'scheduleEnabled': true,
                'isOpenNow': true,
                'acceptingJoins': true,
                'todaySessions': [
                  {'startMinute': 540, 'endMinute': 720},
                  {'startMinute': 840, 'endMinute': 1020},
                ],
              },
            }),
          ),
        ),
      );

      expect(find.text("Today's hours: 09:00–12:00, 14:00–17:00"), findsOneWidget);
      expect(find.text('Each person may use this queue once.'), findsOneWidget);
      // ADR-071 D1: a stale false is ignored.
      expect(find.text('One or several services can be chosen in one visit.'), findsOneWidget);
      expect(find.text('One service per visit.'), findsNothing);
    });

    testWidgets('a paused queue is shown as paused', (tester) async {
      await _pumpDetails(tester, _repository((_) async => _ok(_queueJson({'status': 'PAUSED'}))));

      expect(find.text('Paused'), findsOneWidget);
      expect(find.text('This queue is not currently accepting new arrivals.'), findsOneWidget);
    });

    testWidgets('a queue closed by its schedule says so in the backend own words', (tester) async {
      await _pumpDetails(
        tester,
        _repository(
          (_) async => _ok(
            _queueJson({
              'schedule': {
                'scheduleEnabled': true,
                'isOpenNow': false,
                'acceptingJoins': false,
                'message': "All of today's sessions have ended. Please come back on another day.",
              },
            }),
          ),
        ),
      );

      expect(find.text('Closed for now'), findsOneWidget);
      expect(
        find.text("All of today's sessions have ended. Please come back on another day."),
        findsOneWidget,
      );
    });
  });

  testWidgets('a failed load says the token is unaffected, and can be retried', (tester) async {
    var attempts = 0;
    await _pumpDetails(
      tester,
      _repository((_) async {
        attempts++;
        if (attempts == 1) return http.Response('gateway error', 502);
        return _ok(_queueJson());
      }),
    );

    expect(find.textContaining('Your token is not affected'), findsOneWidget);
    expect(find.text('Customer Service'), findsNothing);

    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();

    expect(attempts, 2);
    expect(find.text('Customer Service'), findsOneWidget);
  });

  group('reached from Live Tracking', () {
    Future<void> pumpTracking(WidgetTester tester, TokenStatus status, List<String> requested) async {
      tester.view.physicalSize = const Size(800, 2000);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            Provider<QueueRepository>.value(
              value: _repository((request) async {
                requested.add(request.url.path);
                return _ok(_queueJson());
              }),
            ),
            ChangeNotifierProvider<TokenTrackingProvider>.value(value: _FakeTracking(status)),
          ],
          child: const MaterialApp(home: LiveTrackingScreen()),
        ),
      );
      await tester.pump();
    }

    testWidgets("the button opens the details of the tracked token's own queue", (tester) async {
      final requested = <String>[];
      await pumpTracking(tester, TokenStatus.waiting, requested);
      expect(requested, isEmpty, reason: 'nothing is fetched until the customer asks');

      await tester.tap(find.text('Queue details'));
      await tester.pumpAndSettle();

      expect(find.byType(QueueDetailsScreen), findsOneWidget);
      expect(requested, ['/api/public/queues/queue-1/config']);
      expect(find.text('Customer Service'), findsOneWidget);
    });

    testWidgets('Back from the details returns to the token, still tracked', (tester) async {
      await pumpTracking(tester, TokenStatus.waiting, []);
      await tester.tap(find.text('Queue details'));
      await tester.pumpAndSettle();

      await tester.pageBack();
      await tester.pumpAndSettle();

      expect(find.byType(QueueDetailsScreen), findsNothing);
      expect(find.byType(LiveTrackingScreen), findsOneWidget);
      expect(find.text('A007'), findsOneWidget);
    });

    for (final status in [TokenStatus.called, TokenStatus.inProgress, TokenStatus.completed]) {
      testWidgets('the button is there for a ${status.name} token too', (tester) async {
        await pumpTracking(tester, status, []);

        expect(find.text('Queue details'), findsOneWidget);
      });
    }
  });
}
