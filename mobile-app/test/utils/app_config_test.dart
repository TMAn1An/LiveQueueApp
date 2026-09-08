// The build-configuration mistake this guards against cost a real debugging
// session: a build with no API_BASE_URL keeps the Android emulator's host
// alias, which is unroutable from a physical phone. Nothing crashes; every
// request just spends its whole timeout, so it surfaces as "the scanner is
// broken" and "the app is slow" rather than as a configuration problem.
//
// A test cannot change a `String.fromEnvironment` constant, so these do not
// try to. They pin the two things that are actually testable and were both
// wrong-by-omission before: that the emulator default is recognisable as
// such, and that the failure message says so.

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:mobile_app/services/api_client.dart';
import 'package:mobile_app/services/api_exception.dart';
import 'package:mobile_app/utils/app_config.dart';
import 'package:mobile_app/widgets/dev_backend_banner.dart';

void main() {
  group('AppConfig', () {
    test('falls back to the emulator alias when no API_BASE_URL was given', () {
      // `flutter test` runs with no --dart-define, so this is the
      // unconfigured build the guard exists for.
      expect(AppConfig.isConfigured, isFalse);
      expect(AppConfig.apiBaseUrl, AppConfig.localDevBaseUrl);
    });

    test('recognises that it is pointed at the local dev backend', () {
      expect(AppConfig.usesLocalDevBackend, isTrue);
    });

    test('the emulator alias is the host loopback address, not a real host', () {
      // If this ever becomes a routable address the banner and the message
      // below stop being true, so it is worth pinning.
      expect(AppConfig.localDevBaseUrl, 'http://10.0.2.2:4000');
    });
  });

  group('an unreachable backend', () {
    Future<String> messageFor(http.Client client) async {
      final api = ApiClient(httpClient: client, baseUrl: AppConfig.apiBaseUrl);
      try {
        await api.get('/api/public/version-policy');
        fail('expected the request to fail');
      } on NetworkException catch (e) {
        return e.message;
      }
    }

    test('names the local dev backend rather than blaming the connection', () async {
      final message = await messageFor(
        // Constructed directly rather than provoked — no socket is opened.
        MockClient((_) async => throw const SocketException('connection failed')),
      );

      expect(message, contains(AppConfig.localDevBaseUrl));
      expect(message, contains('--dart-define=API_BASE_URL'));
    });

    test('says the same thing when the request times out', () async {
      final message = await messageFor(
        MockClient(
          (_) => Future<http.Response>.delayed(
            const Duration(seconds: 30),
            () => http.Response('{}', 200),
          ),
        ),
      );

      expect(message, contains(AppConfig.localDevBaseUrl));
    });
  });

  group('DevBackendBanner', () {
    testWidgets('warns on screen while this build points at the dev backend', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            appBar: PreferredSize(
              preferredSize: Size.fromHeight(40),
              child: DevBackendBanner(),
            ),
          ),
        ),
      );

      expect(find.textContaining('Development build'), findsOneWidget);
      expect(find.textContaining(AppConfig.localDevBaseUrl), findsOneWidget);
    });

    testWidgets('reserves height only while it has something to say', (tester) async {
      const banner = DevBackendBanner();
      expect(
        banner.preferredSize.height,
        AppConfig.usesLocalDevBackend ? greaterThan(0.0) : 0.0,
      );
    });
  });
}
