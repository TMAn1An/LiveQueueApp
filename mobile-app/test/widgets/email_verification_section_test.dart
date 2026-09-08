import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/providers/queue_join_provider.dart';
import 'package:mobile_app/repositories/device_repository.dart';
import 'package:mobile_app/repositories/history_repository.dart';
import 'package:mobile_app/repositories/email_verification_repository.dart';
import 'package:mobile_app/repositories/queue_repository.dart';
import 'package:mobile_app/repositories/token_repository.dart';
import 'package:mobile_app/screens/dynamic_form_screen.dart';
import 'package:mobile_app/services/api_client.dart';
import 'package:mobile_app/services/device_api_service.dart';
import 'package:mobile_app/services/device_identity_service.dart';
import 'package:mobile_app/services/history_storage_service.dart';
import 'package:mobile_app/services/email_verification_api_service.dart';
import 'package:mobile_app/services/queue_api_service.dart';
import 'package:mobile_app/services/socket_service.dart';
import 'package:mobile_app/services/token_api_service.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The join screen for a queue that verifies phone numbers (ADR-034). The
/// customer must not be able to reach "Join Queue" before verifying, and the
/// code they type must never be shown back to them anywhere else.

Map<String, dynamic> _queueJson({required bool requiresEmail}) => {
      'id': 'queue-1',
      'name': 'Relief Distribution',
      'description': null,
      'status': 'ACTIVE',
      'clientTerminology': null,
      'allowMultipleServices': true,
      'identity': {
        'repeatRestricted': requiresEmail,
        'restrictionType': requiresEmail ? 'ONCE_EVER' : null,
        'identityMode': requiresEmail ? 'VERIFIED_EMAIL' : null,
        'identityFieldKey': null,
        'requiresVerifiedEmail': requiresEmail,
        'configurationRequired': false,
      },
      'services': [
        {
          'id': 'service-1',
          'serviceName': 'Collection',
          'description': null,
          'durationMinutes': 5,
        },
      ],
      'formFields': const [],
    };

http.Response _ok(Map<String, dynamic> data, [int status = 200]) =>
    http.Response(jsonEncode({'success': true, 'data': data}), status);

Future<QueueJoinProvider> _provider({required bool requiresEmail}) async {
  final apiClient = ApiClient(
    httpClient: MockClient((request) async {
      if (request.url.path.contains('/config')) {
        return _ok(_queueJson(requiresEmail: requiresEmail));
      }
      if (request.url.path.endsWith('/email-verification/start')) {
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
    }),
    baseUrl: 'http://localhost:4000',
  );
  final provider = QueueJoinProvider(
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
  await provider.loadQueueById('queue-1');
  provider.toggleService('service-1');
  return provider;
}

Future<void> _pump(WidgetTester tester, QueueJoinProvider provider) {
  return tester.pumpWidget(
    ChangeNotifierProvider<QueueJoinProvider>.value(
      value: provider,
      child: const MaterialApp(home: DynamicFormScreen()),
    ),
  );
}

FilledButton _joinButton(WidgetTester tester) {
  return tester.widget<FilledButton>(
    find.ancestor(of: find.text('Join Queue'), matching: find.byType(FilledButton)),
  );
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('a queue that does not verify emails shows no verification step', (tester) async {
    await _pump(tester, await _provider(requiresEmail: false));

    expect(find.text('Verify your email address'), findsNothing);
    expect(_joinButton(tester).onPressed, isNotNull);
  });

  testWidgets('Join stays unavailable until the address is verified', (tester) async {
    final provider = await _provider(requiresEmail: true);
    await _pump(tester, provider);

    expect(find.text('Verify your email address'), findsOneWidget);
    expect(_joinButton(tester).onPressed, isNull);

    await tester.enterText(find.byKey(const Key('email-field')), 'person@example.com');
    await tester.tap(find.byKey(const Key('send-code-button')));
    await tester.pumpAndSettle();

    // A code has been sent but not confirmed — still not joinable.
    expect(find.byKey(const Key('code-field')), findsOneWidget);
    expect(_joinButton(tester).onPressed, isNull);

    await tester.enterText(find.byKey(const Key('code-field')), '123456');
    await tester.pump();
    await tester.tap(find.byKey(const Key('confirm-code-button')));
    await tester.pumpAndSettle();

    expect(find.text('Email address verified'), findsOneWidget);
    expect(_joinButton(tester).onPressed, isNotNull);
  });

  testWidgets('the code the customer typed is not displayed once verified', (tester) async {
    final provider = await _provider(requiresEmail: true);
    await _pump(tester, provider);
    await tester.enterText(find.byKey(const Key('email-field')), 'person@example.com');
    await tester.tap(find.byKey(const Key('send-code-button')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('code-field')), '123456');
    await tester.pump();
    await tester.tap(find.byKey(const Key('confirm-code-button')));
    await tester.pumpAndSettle();

    expect(find.text('123456'), findsNothing);
    // Nor is the proof ever rendered — it is a credential, not information.
    expect(find.text('signed-proof'), findsNothing);
  });

  testWidgets('resend is held back while the cooldown runs', (tester) async {
    final provider = await _provider(requiresEmail: true);
    await _pump(tester, provider);
    await tester.enterText(find.byKey(const Key('email-field')), 'person@example.com');
    await tester.tap(find.byKey(const Key('send-code-button')));
    await tester.pumpAndSettle();

    final resend = tester.widget<TextButton>(find.byKey(const Key('resend-code-button')));
    expect(resend.onPressed, isNull);
    expect(find.textContaining('Resend in'), findsOneWidget);
  });

  testWidgets('changing the address after verifying blocks Join again', (tester) async {
    final provider = await _provider(requiresEmail: true);
    await _pump(tester, provider);
    await tester.enterText(find.byKey(const Key('email-field')), 'person@example.com');
    await tester.tap(find.byKey(const Key('send-code-button')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('code-field')), '123456');
    await tester.pump();
    await tester.tap(find.byKey(const Key('confirm-code-button')));
    await tester.pumpAndSettle();
    expect(_joinButton(tester).onPressed, isNotNull);

    await tester.tap(find.text('Change'));
    await tester.pumpAndSettle();

    expect(find.text('Verify your email address'), findsOneWidget);
    expect(_joinButton(tester).onPressed, isNull);
  });
  testWidgets('offers an email keyboard rather than a phone one', (tester) async {
    await _pump(tester, await _provider(requiresEmail: true));

    final field = tester.widget<TextField>(find.byKey(const Key('email-field')));
    expect(field.keyboardType, TextInputType.emailAddress);
    expect(field.decoration!.labelText, 'Email address');
  });

  testWidgets('will not send a code for an empty address', (tester) async {
    final provider = await _provider(requiresEmail: true);
    await _pump(tester, provider);

    await tester.tap(find.byKey(const Key('send-code-button')));
    await tester.pumpAndSettle();

    // No challenge started, and the customer is told why.
    expect(find.byKey(const Key('code-field')), findsNothing);
    expect(provider.verificationError, isNotNull);
  });

  testWidgets('offers a resend once the cooldown has passed', (tester) async {
    final provider = await _provider(requiresEmail: true);
    await _pump(tester, provider);
    await tester.enterText(find.byKey(const Key('email-field')), 'person@example.com');
    await tester.tap(find.byKey(const Key('send-code-button')));
    await tester.pumpAndSettle();
    expect(find.textContaining('Resend in'), findsOneWidget);

    // The countdown is read from the provider, so moving it into the past is
    // what a minute later looks like.
    provider.resendAvailableAt = DateTime.now().subtract(const Duration(seconds: 1));
    await tester.pump(const Duration(seconds: 1));

    final resend = tester.widget<TextButton>(find.byKey(const Key('resend-code-button')));
    expect(resend.onPressed, isNotNull);
    expect(find.text('Resend code'), findsOneWidget);
  });
}
