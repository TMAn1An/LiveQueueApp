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
import 'package:mobile_app/screens/service_selection_screen.dart';
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

/// V2 Checkpoint 5 (ADR-027), ADR-070: a multi-service visit is an ordered
/// journey built from "Add" chips — proves the actual tap interaction, not a
/// pixel snapshot.
///
/// ADR-063: this is also the first screen after a scan, so everything the
/// removed Queue Details screen used to say and to refuse is covered here.
const _twoServices = [
  {'id': 'service-1', 'serviceName': 'General Inquiry', 'description': null, 'durationMinutes': 5},
  {'id': 'service-2', 'serviceName': 'Document Check', 'description': null, 'durationMinutes': 7},
];

Map<String, dynamic> _queueJson([Map<String, dynamic> overrides = const {}]) => {
      'id': 'queue-1',
      'name': 'Customer Service',
      'description': null,
      'status': 'ACTIVE',
      'clientTerminology': null,
      'services': _twoServices,
      'formFields': <Map<String, dynamic>>[],
      ...overrides,
    };

Future<QueueJoinProvider> _buildLoadedProvider([Map<String, dynamic> overrides = const {}]) async {
  final mockClient = MockClient((request) async {
    return http.Response(jsonEncode({'success': true, 'data': _queueJson(overrides)}), 200);
  });
  final apiClient = ApiClient(httpClient: mockClient, baseUrl: 'http://localhost:4000');
  final provider = QueueJoinProvider(
    queueRepository: QueueRepository(apiService: QueueApiService(apiClient)),
    tokenRepository: TokenRepository(apiService: TokenApiService(apiClient), socketService: SocketService()),
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
  return provider;
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  Future<void> pump(WidgetTester tester, QueueJoinProvider provider) {
    return tester.pumpWidget(
      MaterialApp(
        home: ChangeNotifierProvider<QueueJoinProvider>.value(
          value: provider,
          child: const ServiceSelectionScreen(),
        ),
      ),
    );
  }

  /// A queue the customer cannot join offers neither a service nor a way on.
  void expectNoWayToJoin() {
    expect(find.text('General Inquiry'), findsNothing);
    expect(find.text('Document Check'), findsNothing);
    expect(find.widgetWithText(FilledButton, 'Next'), findsNothing);
  }

  testWidgets('checking two services selects both, sums the duration, and enables Next', (tester) async {
    final provider = await _buildLoadedProvider();
    await pump(tester, provider);

    expect(find.text('Estimated service time: 0 minutes'), findsOneWidget);
    final nextButtonBefore = tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Next'));
    expect(nextButtonBefore.onPressed, isNull);

    await tester.tap(find.widgetWithText(ActionChip, 'General Inquiry'));
    await tester.pump();
    await tester.tap(find.widgetWithText(ActionChip, 'Document Check'));
    await tester.pump();

    expect(find.text('Estimated service time: 12 minutes'), findsOneWidget);
    final nextButtonAfter = tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Next'));
    expect(nextButtonAfter.onPressed, isNotNull);
  });

  testWidgets('removing a step removes only that one from the total', (tester) async {
    final provider = await _buildLoadedProvider();
    await pump(tester, provider);

    await tester.tap(find.widgetWithText(ActionChip, 'General Inquiry'));
    await tester.pump();
    await tester.tap(find.widgetWithText(ActionChip, 'Document Check'));
    await tester.pump();
    expect(find.text('Estimated service time: 12 minutes'), findsOneWidget);

    await tester.tap(find.byTooltip('Remove step 1, General Inquiry'));
    await tester.pump();

    expect(find.text('Estimated service time: 7 minutes'), findsOneWidget);
    expect(provider.journeySteps, ['service-2']);
  });

  // ADR-070: a multi-service visit is an ordered journey.
  group('ordered journey', () {
    testWidgets('steps are numbered in the order added and can be reordered with the arrows', (tester) async {
      final provider = await _buildLoadedProvider();
      await pump(tester, provider);

      await tester.tap(find.widgetWithText(ActionChip, 'General Inquiry'));
      await tester.pump();
      await tester.tap(find.widgetWithText(ActionChip, 'Document Check'));
      await tester.pump();
      expect(provider.journeySteps, ['service-1', 'service-2']);

      await tester.tap(find.byTooltip('Move Document Check up'));
      await tester.pump();
      expect(provider.journeySteps, ['service-2', 'service-1']);
      expect(find.bySemanticsLabel(RegExp(r'^Step 1 of 2: Document Check')), findsOneWidget);
    });

    testWidgets('a service may repeat, but never twice in a row and never past its limit', (tester) async {
      final provider = await _buildLoadedProvider({
        'services': [
          {..._twoServices[0], 'maxOccurrencesPerJourney': 2},
          {..._twoServices[1], 'maxOccurrencesPerJourney': 1},
        ],
      });
      await pump(tester, provider);

      await tester.tap(find.widgetWithText(ActionChip, 'General Inquiry'));
      await tester.pump();
      // Right after itself: not offered.
      expect(tester.widget<ActionChip>(find.widgetWithText(ActionChip, 'General Inquiry (1/2)')).onPressed, isNull);
      await tester.tap(find.widgetWithText(ActionChip, 'Document Check'));
      await tester.pump();
      // Document Check's limit is 1.
      expect(tester.widget<ActionChip>(find.widgetWithText(ActionChip, 'Document Check (1/1)')).onPressed, isNull);
      await tester.tap(find.widgetWithText(ActionChip, 'General Inquiry (1/2)'));
      await tester.pump();
      expect(provider.journeySteps, ['service-1', 'service-2', 'service-1']);
      expect(tester.widget<ActionChip>(find.widgetWithText(ActionChip, 'General Inquiry (2/2)')).onPressed, isNull);

      // Removing the middle step brings the two equal steps together: refused.
      await tester.tap(find.byTooltip('Remove step 2, Document Check'));
      await tester.pump();
      expect(find.text("General Inquiry can't be two steps in a row."), findsOneWidget);
      expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Next')).onPressed, isNull);
    });

    testWidgets("starts from the queue's recommended order", (tester) async {
      final provider = await _buildLoadedProvider({'recommendedJourney': ['service-2', 'service-1']});
      await pump(tester, provider);
      expect(provider.journeySteps, ['service-2', 'service-1']);
      expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Next')).onPressed, isNotNull);
    });
  });

  group('the queue itself, shown above its services', () {
    testWidgets('names the queue and shows its description', (tester) async {
      final provider = await _buildLoadedProvider({'description': 'Ground floor, desk 3'});
      await pump(tester, provider);

      expect(find.text('Customer Service'), findsOneWidget);
      expect(find.text('Ground floor, desk 3'), findsOneWidget);
      expect(find.text('General Inquiry'), findsOneWidget);
    });

    testWidgets('an open queue with no limits shows no notice', (tester) async {
      final provider = await _buildLoadedProvider();
      await pump(tester, provider);

      expect(find.textContaining('not currently accepting'), findsNothing);
      expect(find.textContaining('Each person'), findsNothing);
      expect(find.textContaining("Today's hours"), findsNothing);
    });
  });

  group('how many services there are', () {
    testWidgets('a single service is offered, not chosen for the customer', (tester) async {
      final provider = await _buildLoadedProvider({
        'services': [_twoServices.first],
      });
      await pump(tester, provider);

      expect(find.widgetWithText(ActionChip, 'General Inquiry'), findsOneWidget);
      expect(provider.selectedServiceIds, isEmpty);
      expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Next')).onPressed, isNull);

      await tester.tap(find.widgetWithText(ActionChip, 'General Inquiry'));
      await tester.pump();

      expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Next')).onPressed, isNotNull);
    });

    testWidgets('a one-service-per-visit queue swaps the choice instead of adding to it', (tester) async {
      final provider = await _buildLoadedProvider({'allowMultipleServices': false});
      await pump(tester, provider);

      await tester.tap(find.widgetWithText(RadioListTile<String>, 'General Inquiry'));
      await tester.pump();
      await tester.tap(find.widgetWithText(RadioListTile<String>, 'Document Check'));
      await tester.pump();

      expect(provider.selectedServiceIds, {'service-2'});
      expect(find.text('Estimated service time: 7 minutes'), findsOneWidget);
    });

    testWidgets('a queue with no services says so and offers no way on', (tester) async {
      final provider = await _buildLoadedProvider({'services': <Map<String, dynamic>>[]});
      await pump(tester, provider);

      expect(find.text('Customer Service'), findsOneWidget);
      expect(find.text('No services are currently available.'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Next'), findsNothing);
    });
  });

  group('a queue that cannot be joined says why, before anything is chosen', () {
    for (final status in ['PAUSED', 'INACTIVE']) {
      testWidgets('a $status queue', (tester) async {
        final provider = await _buildLoadedProvider({'status': status});
        await pump(tester, provider);

        expect(find.text('Customer Service'), findsOneWidget);
        expect(find.text('This queue is not currently accepting new arrivals.'), findsOneWidget);
        expectNoWayToJoin();
      });
    }

    testWidgets('a queue that limits repeat visits but cannot yet recognise customers', (tester) async {
      final provider = await _buildLoadedProvider({
        'identity': {'repeatRestricted': true, 'restrictionType': 'ONCE_EVER', 'configurationRequired': true},
      });
      await pump(tester, provider);

      expect(
        find.text('This queue is not accepting anyone yet. Please contact staff.'),
        findsOneWidget,
      );
      expectNoWayToJoin();
    });

    testWidgets("a scheduled queue that is closed, in the backend's own words", (tester) async {
      final provider = await _buildLoadedProvider({
        'schedule': {
          'scheduleEnabled': true,
          'isOpenNow': false,
          'acceptingJoins': false,
          'unavailableCode': 'SCHEDULE_ENDED_TODAY',
          'message': "All of today's sessions have ended. Please come back on another day.",
        },
      });
      await pump(tester, provider);

      expect(
        find.text("All of today's sessions have ended. Please come back on another day."),
        findsOneWidget,
      );
      expectNoWayToJoin();
    });

    testWidgets('a full session', (tester) async {
      final provider = await _buildLoadedProvider({
        'schedule': {
          'scheduleEnabled': true,
          'isOpenNow': true,
          'acceptingJoins': false,
          'message': 'This session is full.',
        },
      });
      await pump(tester, provider);

      expect(find.text('This session is full.'), findsOneWidget);
      expectNoWayToJoin();
    });
  });

  group('a queue that can be joined still says what the customer should know', () {
    testWidgets('a later session today: joining is allowed and the customer is told when', (tester) async {
      const note =
          'The next session starts today at 14:00. You can join now and will be served in a later session.';
      final provider = await _buildLoadedProvider({
        'schedule': {
          'scheduleEnabled': true,
          'isOpenNow': false,
          'acceptingJoins': true,
          'nextSessionStartMinute': 840,
          'message': note,
          'todaySessions': [
            {'startMinute': 540, 'endMinute': 720},
            {'startMinute': 840, 'endMinute': 1020},
          ],
        },
      });
      await pump(tester, provider);

      expect(find.text(note), findsOneWidget);
      expect(find.text("Today's hours: 09:00–12:00, 14:00–17:00"), findsOneWidget);
      expect(find.widgetWithText(ActionChip, 'General Inquiry'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Next'), findsOneWidget);
    });

    testWidgets('a once-only queue', (tester) async {
      final provider = await _buildLoadedProvider({
        'identity': {'repeatRestricted': true, 'restrictionType': 'ONCE_EVER'},
      });
      await pump(tester, provider);

      expect(find.text('Each person may use this queue once.'), findsOneWidget);
      expect(find.widgetWithText(ActionChip, 'General Inquiry'), findsOneWidget);
    });

    testWidgets('a wait between visits', (tester) async {
      final provider = await _buildLoadedProvider({
        'identity': {
          'repeatRestricted': true,
          'restrictionType': 'DURATION',
          'restrictionAmount': 1,
          'restrictionUnit': 'WEEK',
        },
      });
      await pump(tester, provider);

      expect(find.text('After being served, you can use this queue again in 1 week.'), findsOneWidget);
    });

    testWidgets('a limit that applies per session says so', (tester) async {
      final provider = await _buildLoadedProvider({
        'identity': {
          'repeatRestricted': true,
          'restrictionType': 'ONCE_EVER',
          'restrictionScope': 'SESSION',
        },
      });
      await pump(tester, provider);

      expect(
        find.text('Each person may be served once per session. You can still join a different session.'),
        findsOneWidget,
      );
    });
  });

  testWidgets('with no queue loaded there is nothing to choose from', (tester) async {
    final provider = await _buildLoadedProvider();
    provider.reset();
    await pump(tester, provider);

    expect(find.text('Queue not found.'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Next'), findsNothing);
  });
}
