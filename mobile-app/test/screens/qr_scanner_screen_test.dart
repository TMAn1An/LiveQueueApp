import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:mobile_app/providers/queue_join_provider.dart';
import 'package:mobile_app/repositories/device_repository.dart';
import 'package:mobile_app/repositories/email_verification_repository.dart';
import 'package:mobile_app/repositories/history_repository.dart';
import 'package:mobile_app/repositories/queue_repository.dart';
import 'package:mobile_app/repositories/token_repository.dart';
import 'package:mobile_app/screens/qr_scanner_screen.dart';
import 'package:mobile_app/screens/service_selection_screen.dart';
import 'package:mobile_app/services/api_client.dart';
import 'package:mobile_app/services/device_api_service.dart';
import 'package:mobile_app/services/device_identity_service.dart';
import 'package:mobile_app/services/email_verification_api_service.dart';
import 'package:mobile_app/services/history_storage_service.dart';
import 'package:mobile_app/services/queue_api_service.dart';
import 'package:mobile_app/services/socket_service.dart';
import 'package:mobile_app/services/token_api_service.dart';

import '../support/fake_mobile_scanner_platform.dart';

const _validQr = 'livequeue://queue/3f2504e0-4f89-11d3-9a0c-0305e82c3301';

Map<String, dynamic> _queueJson() => {
      'id': '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      'name': 'Customer Service',
      'description': null,
      'status': 'ACTIVE',
      'clientTerminology': null,
      'services': [
        {
          'id': 'service-1',
          'serviceName': 'General Inquiry',
          'description': null,
          'durationMinutes': 5,
        },
      ],
      'formFields': [],
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
    emailVerificationRepository: EmailVerificationRepository(
      apiService: EmailVerificationApiService(apiClient),
    ),
  );
}

Future<void> _pumpScanner(WidgetTester tester, QueueJoinProvider provider) async {
  await tester.pumpWidget(
    ChangeNotifierProvider<QueueJoinProvider>.value(
      value: provider,
      child: const MaterialApp(home: QrScannerScreen()),
    ),
  );
  await tester.pumpAndSettle();
}

/// The scanner as it is really reached: pushed on top of another screen, so
/// there is somewhere for Back to go.
Future<void> _pumpScannerOverHome(WidgetTester tester, QueueJoinProvider provider) async {
  await tester.pumpWidget(
    ChangeNotifierProvider<QueueJoinProvider>.value(
      value: provider,
      child: MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: TextButton(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(builder: (_) => const QrScannerScreen()),
                ),
                child: const Text('home: open scanner'),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('home: open scanner'));
  await tester.pumpAndSettle();
}

void main() {
  late FakeMobileScannerPlatform fakeScanner;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    fakeScanner = FakeMobileScannerPlatform();
    MobileScannerPlatform.instance = fakeScanner;
  });

  group('a scan that resolves', () {
    testWidgets('loads the queue named by a valid livequeue:// code', (tester) async {
      final provider = _buildProvider(
        MockClient((_) async =>
            http.Response(jsonEncode({'success': true, 'data': _queueJson()}), 200)),
      );
      await _pumpScanner(tester, provider);

      fakeScanner.emitBarcode(_validQr);
      await tester.pumpAndSettle();

      expect(provider.queueConfig, isNotNull);
      expect(provider.queueConfig!.name, 'Customer Service');
      expect(provider.errorMessage, isNull);
    });

    testWidgets('stops the camera once it has a code worth acting on', (tester) async {
      final provider = _buildProvider(
        MockClient((_) async =>
            http.Response(jsonEncode({'success': true, 'data': _queueJson()}), 200)),
      );
      await _pumpScanner(tester, provider);
      expect(fakeScanner.startCount, 1);

      fakeScanner.emitBarcode(_validQr);
      await tester.pumpAndSettle();

      expect(fakeScanner.stopCount, greaterThan(0));
    });
  });

  // ADR-063: there is no Queue Details screen between the scan and the
  // services any more.
  group('after a valid scan the customer is on the services screen', () {
    QueueJoinProvider providerFor(Map<String, dynamic> queue) => _buildProvider(
          MockClient((_) async => http.Response(jsonEncode({'success': true, 'data': queue}), 200)),
        );

    testWidgets('directly — no screen in between, and nothing to tap first', (tester) async {
      await _pumpScannerOverHome(tester, providerFor(_queueJson()));

      fakeScanner.emitBarcode(_validQr);
      await tester.pumpAndSettle();

      expect(find.byType(ServiceSelectionScreen), findsOneWidget);
      expect(find.text('Select Services'), findsOneWidget);
      expect(find.text('Queue Details'), findsNothing);
      expect(find.text('Continue'), findsNothing);
      // The queue is still named, and its service is there to choose.
      expect(find.text('Customer Service'), findsOneWidget);
      expect(find.text('General Inquiry'), findsOneWidget);
    });

    testWidgets('Back returns to where scanning started — not to a details screen or the scanner',
        (tester) async {
      await _pumpScannerOverHome(tester, providerFor(_queueJson()));
      fakeScanner.emitBarcode(_validQr);
      await tester.pumpAndSettle();

      await tester.pageBack();
      await tester.pumpAndSettle();

      expect(find.text('home: open scanner'), findsOneWidget);
      expect(find.byType(ServiceSelectionScreen), findsNothing);
      expect(find.byType(QrScannerScreen), findsNothing);
      expect(find.text('Queue Details'), findsNothing);
    });

    testWidgets('the Android system Back does the same', (tester) async {
      await _pumpScannerOverHome(tester, providerFor(_queueJson()));
      fakeScanner.emitBarcode(_validQr);
      await tester.pumpAndSettle();

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();

      expect(find.text('home: open scanner'), findsOneWidget);
      expect(find.byType(ServiceSelectionScreen), findsNothing);
    });

    testWidgets('a paused queue still opens there, saying why it cannot be joined', (tester) async {
      await _pumpScannerOverHome(tester, providerFor({..._queueJson(), 'status': 'PAUSED'}));

      fakeScanner.emitBarcode(_validQr);
      await tester.pumpAndSettle();

      expect(find.byType(ServiceSelectionScreen), findsOneWidget);
      expect(find.text('This queue is not currently accepting new customers.'), findsOneWidget);
      expect(find.text('General Inquiry'), findsNothing);
      expect(find.widgetWithText(FilledButton, 'Next'), findsNothing);
    });

    testWidgets('choosing a service leads on to the next step of the join', (tester) async {
      await _pumpScannerOverHome(tester, providerFor(_queueJson()));
      fakeScanner.emitBarcode(_validQr);
      await tester.pumpAndSettle();

      await tester.tap(find.widgetWithText(CheckboxListTile, 'General Inquiry'));
      await tester.pump();

      final next = tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Next'));
      expect(next.onPressed, isNotNull);
    });
  });

  group('a scan that does not resolve', () {
    testWidgets('explains a code that is not a LiveQueue code', (tester) async {
      var requests = 0;
      final provider = _buildProvider(MockClient((_) async {
        requests++;
        return http.Response(jsonEncode({'success': true, 'data': _queueJson()}), 200);
      }));
      await _pumpScanner(tester, provider);

      fakeScanner.emitBarcode('https://example.com/not-a-queue');
      await tester.pumpAndSettle();

      expect(provider.errorMessage, contains('not a LiveQueue code'));
      expect(provider.queueConfig, isNull);
      expect(requests, 0, reason: 'a malformed code must never reach the backend');
      expect(find.text('This QR code is not a LiveQueue code.'), findsOneWidget);
    });

    testWidgets('leaves the scanner usable after an unknown queue, and scans again',
        (tester) async {
      var lookups = 0;
      final provider = _buildProvider(MockClient((_) async {
        lookups++;
        if (lookups == 1) {
          return http.Response(
            jsonEncode({
              'success': false,
              'error': {'code': 'QUEUE_NOT_FOUND', 'message': 'Queue not found.'},
            }),
            404,
          );
        }
        return http.Response(jsonEncode({'success': true, 'data': _queueJson()}), 200);
      }));
      await _pumpScanner(tester, provider);

      fakeScanner.emitBarcode(_validQr);
      await tester.pumpAndSettle();
      expect(provider.errorMessage, contains('could not be found'));

      // The camera was restarted rather than left stopped, which is the whole
      // difference between "that code did not work" and a wedged scanner.
      expect(fakeScanner.isRunning, isTrue);
      expect(fakeScanner.startCount, greaterThan(1));

      // And a second code is genuinely acted on, not swallowed by a latch
      // left set from the failure.
      fakeScanner.emitBarcode(_validQr);
      await tester.pumpAndSettle();

      expect(lookups, 2);
      expect(provider.queueConfig, isNotNull);
      expect(provider.errorMessage, isNull);
    });

    testWidgets('recovers the same way when the lookup throws rather than answering',
        (tester) async {
      var lookups = 0;
      final provider = _buildProvider(MockClient((_) async {
        lookups++;
        throw const _TransportFailure();
      }));
      await _pumpScanner(tester, provider);

      fakeScanner.emitBarcode(_validQr);
      await tester.pumpAndSettle();

      expect(provider.errorMessage, isNotNull);
      expect(fakeScanner.isRunning, isTrue);

      fakeScanner.emitBarcode(_validQr);
      await tester.pumpAndSettle();
      expect(lookups, 2);
    });
  });

  group('duplicate detections', () {
    testWidgets('a code held in frame is looked up once, not once per frame', (tester) async {
      var lookups = 0;
      final provider = _buildProvider(MockClient((_) async {
        lookups++;
        return http.Response(jsonEncode({'success': true, 'data': _queueJson()}), 200);
      }));
      await _pumpScanner(tester, provider);

      // Three detections of the same code before any of them can complete —
      // what a real camera produces while the code stays in view.
      fakeScanner.emitBarcode(_validQr);
      fakeScanner.emitBarcode(_validQr);
      fakeScanner.emitBarcode(_validQr);
      await tester.pumpAndSettle();

      expect(lookups, 1);
    });

    testWidgets('an empty detection is ignored without disturbing the scanner', (tester) async {
      var lookups = 0;
      final provider = _buildProvider(MockClient((_) async {
        lookups++;
        return http.Response(jsonEncode({'success': true, 'data': _queueJson()}), 200);
      }));
      await _pumpScanner(tester, provider);

      fakeScanner.emitBarcode('');
      await tester.pumpAndSettle();

      expect(lookups, 0);
      expect(provider.errorMessage, isNull);
      expect(fakeScanner.isRunning, isTrue);
    });
  });

  group('camera availability', () {
    testWidgets('a denied camera permission is explained, and does not crash', (tester) async {
      fakeScanner.startError = MobileScannerErrorCode.permissionDenied;
      final provider = _buildProvider(MockClient((_) async => http.Response('{}', 200)));

      await _pumpScanner(tester, provider);

      expect(find.textContaining('needs camera access'), findsOneWidget);
    });

    testWidgets('an unavailable camera says something different from a denied one',
        (tester) async {
      fakeScanner.startError = MobileScannerErrorCode.genericError;
      final provider = _buildProvider(MockClient((_) async => http.Response('{}', 200)));

      await _pumpScanner(tester, provider);

      expect(find.textContaining('could not be started'), findsOneWidget);
    });
  });

  group('leaving and coming back', () {
    testWidgets('a freshly opened scanner starts the camera again', (tester) async {
      final provider = _buildProvider(
        MockClient((_) async =>
            http.Response(jsonEncode({'success': true, 'data': _queueJson()}), 200)),
      );
      await _pumpScanner(tester, provider);
      expect(fakeScanner.startCount, 1);

      // Leave the screen.
      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      await tester.pumpAndSettle();

      // Come back to a new instance, as Home's push does.
      await _pumpScanner(tester, provider);

      expect(fakeScanner.startCount, 2);
      expect(fakeScanner.isRunning, isTrue);
    });
  });
}

/// A stand-in for a transport failure, so the test does not depend on
/// `dart:io` being reachable from the test environment.
class _TransportFailure implements Exception {
  const _TransportFailure();
}
