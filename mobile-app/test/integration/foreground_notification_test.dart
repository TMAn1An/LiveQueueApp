// The foreground banner + Notification Center wiring end to end (V2
// Physical Validation + Foreground Notification checkpoint). Mirrors
// exactly how main.dart wires NotificationCenterProvider.onNotificationAdded
// into ForegroundBannerService, so these tests exercise the real
// composition rather than a simplified stand-in.

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/models/app_notification.dart';
import 'package:mobile_app/models/live_queue_token.dart';
import 'package:mobile_app/models/notification_preferences.dart';
import 'package:mobile_app/providers/active_token_provider.dart';
import 'package:mobile_app/providers/history_provider.dart';
import 'package:mobile_app/providers/notification_center_provider.dart';
import 'package:mobile_app/providers/notification_preferences_provider.dart';
import 'package:mobile_app/providers/token_tracking_provider.dart';
import 'package:mobile_app/repositories/device_repository.dart';
import 'package:mobile_app/repositories/history_repository.dart';
import 'package:mobile_app/repositories/notification_preferences_repository.dart';
import 'package:mobile_app/repositories/token_repository.dart';
import 'package:mobile_app/screens/home_screen.dart';
import 'package:mobile_app/screens/live_tracking_screen.dart';
import 'package:mobile_app/screens/token_history_screen.dart';
import 'package:mobile_app/services/active_token_storage_service.dart';
import 'package:mobile_app/services/api_client.dart';
import 'package:mobile_app/services/device_api_service.dart';
import 'package:mobile_app/services/device_identity_service.dart';
import 'package:mobile_app/services/fcm_service.dart';
import 'package:mobile_app/services/foreground_banner_service.dart';
import 'package:mobile_app/services/history_storage_service.dart';
import 'package:mobile_app/services/notification_center_storage_service.dart';
import 'package:mobile_app/services/notification_service.dart';
import 'package:mobile_app/services/preferences_storage_service.dart';
import 'package:mobile_app/services/socket_service.dart';
import 'package:mobile_app/services/token_api_service.dart';
import 'package:mobile_app/utils/open_active_token.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

LiveQueueToken buildToken({
  required String id,
  required String queueId,
  required String serial,
  String status = 'CALLED',
}) =>
    LiveQueueToken.fromJson({
      'id': id,
      'queueId': queueId,
      'serviceId': 'service-1',
      'serialNumber': serial,
      'status': status,
      'formData': <String, dynamic>{},
      'position': 1,
      'estimatedWaitMinutes': 5,
      'counter': null,
      'createdAt': DateTime.utc(2026, 1, 1).toIso8601String(),
      'calledAt': status == 'CALLED' ? DateTime.utc(2026, 1, 1).toIso8601String() : null,
      'startedAt': null,
      'completedAt': null,
      'skippedAt': null,
    });

http.Response ok(Map<String, dynamic> data) =>
    http.Response(jsonEncode({'success': true, 'data': data}), 200);

/// The real start() opens a real socket_io_client connection a widget test
/// can never let finish — see prior checkpoints' identical stub.
class StubTracking extends TokenTrackingProvider {
  StubTracking(ApiClient client)
      : super(
          tokenRepository: TokenRepository(
            apiService: TokenApiService(client),
            socketService: SocketService(),
          ),
          deviceRepository: DeviceRepository(
            identityService: DeviceIdentityService(),
            apiService: DeviceApiService(client),
          ),
          historyRepository: HistoryRepository(storageService: HistoryStorageService()),
          notificationService: NotificationService(),
          fcmService: FcmService(notificationService: NotificationService()),
        );

  @override
  void start(LiveQueueToken initialToken, NotificationPreferences preferences, {String queueName = ''}) {
    token = initialToken;
    notifyListeners();
  }
}

/// Wires NotificationCenterProvider -> ForegroundBannerService exactly as
/// main.dart does: every genuinely new entry raises a banner except a join.
/// The service is created by the caller, not here, so every test can
/// dispose it (cancelling any pending auto-dismiss timer) before it ends —
/// otherwise a test that triggers a banner and never waits out its
/// 5-second timer leaves that timer pending after the widget tree is torn
/// down.
Widget appUnder({
  required Widget home,
  required ApiClient apiClient,
  required ActiveTokenProvider activeToken,
  required GlobalKey<NavigatorState> navigatorKey,
  required ForegroundBannerService bannerService,
}) {
  return MultiProvider(
    providers: [
      Provider<ForegroundBannerService>.value(value: bannerService),
      ChangeNotifierProvider<ActiveTokenProvider>.value(value: activeToken),
      ChangeNotifierProvider<TokenTrackingProvider>(create: (_) => StubTracking(apiClient)),
      ChangeNotifierProvider<NotificationPreferencesProvider>(
        create: (_) => NotificationPreferencesProvider(
          repository: NotificationPreferencesRepository(storageService: PreferencesStorageService()),
          notificationService: NotificationService(),
        ),
      ),
      ChangeNotifierProvider<NotificationCenterProvider>(
        create: (context) => NotificationCenterProvider(
          storage: NotificationCenterStorageService(),
          onNotificationAdded: (notification) {
            if (notification.kind == NotificationKind.joined) return;
            final navContext = navigatorKey.currentContext;
            if (navContext == null) return;
            bannerService.show(
              title: notification.title,
              body: notification.body,
              onTap: () => openActiveToken(navContext, notification.tokenId),
            );
          },
        )..load(),
      ),
      Provider<HistoryRepository>(create: (_) => HistoryRepository(storageService: HistoryStorageService())),
      ChangeNotifierProvider<HistoryProvider>(
        create: (context) => HistoryProvider(historyRepository: context.read<HistoryRepository>()),
      ),
    ],
    child: MaterialApp(navigatorKey: navigatorKey, home: home),
  );
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('a meaningful event raises a banner while Home is visible', (tester) async {
    final navigatorKey = GlobalKey<NavigatorState>();
    final bannerService = ForegroundBannerService(navigatorKey);
    final apiClient = ApiClient(
      httpClient: MockClient((_) async => ok(jsonDecode(jsonEncode(buildToken(
              id: 'token-a', queueId: 'queue-a', serial: 'A002', status: 'CALLED')
          .toJson()))
          as Map<String, dynamic>)),
      baseUrl: 'http://localhost:4000',
    );
    final activeToken = ActiveTokenProvider(
      tokenRepository: TokenRepository(apiService: TokenApiService(apiClient), socketService: SocketService()),
      storage: ActiveTokenStorageService(),
    );
    await activeToken.remember(buildToken(id: 'token-a', queueId: 'queue-a', serial: 'A002'), queueName: 'Pharmacy');

    await tester.pumpWidget(appUnder(
      home: const HomeScreen(),
      apiClient: apiClient,
      activeToken: activeToken,
      navigatorKey: navigatorKey,
      bannerService: bannerService,
    ));
    await tester.pump();

    navigatorKey.currentContext!
        .read<NotificationCenterProvider>()
        .recordStatusChange(
          buildToken(id: 'token-a', queueId: 'queue-a', serial: 'A002', status: 'CALLED'),
          queueName: 'Pharmacy',
        );
    await tester.pump();

    expect(find.text('Your token was called'), findsOneWidget);
    expect(find.textContaining('A002'), findsWidgets);

    bannerService.dispose();
  });

  testWidgets('a meaningful event raises a banner while History is visible', (tester) async {
    final navigatorKey = GlobalKey<NavigatorState>();
    final bannerService = ForegroundBannerService(navigatorKey);
    final apiClient = ApiClient(baseUrl: 'http://localhost:4000');
    final activeToken = ActiveTokenProvider(
      tokenRepository: TokenRepository(apiService: TokenApiService(apiClient), socketService: SocketService()),
      storage: ActiveTokenStorageService(),
    );

    await tester.pumpWidget(appUnder(
      home: const TokenHistoryScreen(),
      apiClient: apiClient,
      activeToken: activeToken,
      navigatorKey: navigatorKey,
      bannerService: bannerService,
    ));
    await tester.pump();
    expect(find.text('Token History'), findsOneWidget);

    navigatorKey.currentContext!.read<NotificationCenterProvider>().recordStatusChange(
          buildToken(id: 'token-a', queueId: 'queue-a', serial: 'A002', status: 'COMPLETED'),
          queueName: 'Pharmacy',
        );
    await tester.pump();

    expect(find.text('Token completed'), findsOneWidget);
    // The screen underneath is untouched — this is an overlay, not a route.
    expect(find.text('Token History'), findsOneWidget);

    bannerService.dispose();
  });

  testWidgets(
      'Token B is called while Token A is being viewed: banner identifies B, tapping it opens B, A is untouched',
      (tester) async {
    final navigatorKey = GlobalKey<NavigatorState>();
    final bannerService = ForegroundBannerService(navigatorKey);
    final apiClient = ApiClient(
      httpClient: MockClient((request) async {
        if (request.url.path.contains('token-b')) {
          return ok(jsonDecode(jsonEncode(
                  buildToken(id: 'token-b', queueId: 'queue-b', serial: 'B014', status: 'CALLED').toJson()))
              as Map<String, dynamic>);
        }
        return ok(jsonDecode(jsonEncode(
                buildToken(id: 'token-a', queueId: 'queue-a', serial: 'A002', status: 'WAITING').toJson()))
            as Map<String, dynamic>);
      }),
      baseUrl: 'http://localhost:4000',
    );
    final activeToken = ActiveTokenProvider(
      tokenRepository: TokenRepository(apiService: TokenApiService(apiClient), socketService: SocketService()),
      storage: ActiveTokenStorageService(),
    );
    await activeToken.remember(buildToken(id: 'token-a', queueId: 'queue-a', serial: 'A002', status: 'WAITING'),
        queueName: 'Pharmacy');
    await activeToken.remember(buildToken(id: 'token-b', queueId: 'queue-b', serial: 'B014', status: 'WAITING'),
        queueName: 'Billing');

    await tester.pumpWidget(appUnder(
      home: const HomeScreen(),
      apiClient: apiClient,
      activeToken: activeToken,
      navigatorKey: navigatorKey,
      bannerService: bannerService,
    ));
    await tester.pump();

    // Token B is called — recorded exactly as ActiveTokenProvider's own
    // onTokenStatusChanged callback would after a resync (main.dart wires
    // that separately; here we drive the Notification Center directly,
    // which is the shared path both routes converge on).
    navigatorKey.currentContext!.read<NotificationCenterProvider>().recordStatusChange(
          buildToken(id: 'token-b', queueId: 'queue-b', serial: 'B014', status: 'CALLED'),
          queueName: 'Billing',
        );
    await tester.pump();

    // "Your token was called" is banner-only text — Home's own multi-token
    // list never says that, only the serial/queue label — so this alone
    // already proves the banner appeared. "B014 · Billing" legitimately
    // appears twice once it does: once in the banner, once in Home's own
    // row for the token underneath it (Token A is still remembered too).
    expect(find.text('Your token was called'), findsOneWidget);
    expect(find.text('B014 · Billing'), findsWidgets);

    await tester.tap(find.text('View'));
    await tester.pumpAndSettle();

    expect(find.byType(LiveTrackingScreen), findsOneWidget);
    final tracking = navigatorKey.currentContext!.read<TokenTrackingProvider>();
    expect(tracking.token?.id, 'token-b');

    // Token A must still be remembered — opening B's banner never touches it.
    expect(activeToken.summaryFor('token-a'), isNotNull);

    await tester.pageBack();
    await tester.pumpAndSettle();
    bannerService.dispose();
  });

  testWidgets('the event is also saved to the Notification Center, not only shown as a banner',
      (tester) async {
    final navigatorKey = GlobalKey<NavigatorState>();
    final bannerService = ForegroundBannerService(navigatorKey);
    final apiClient = ApiClient(baseUrl: 'http://localhost:4000');
    final activeToken = ActiveTokenProvider(
      tokenRepository: TokenRepository(apiService: TokenApiService(apiClient), socketService: SocketService()),
      storage: ActiveTokenStorageService(),
    );

    await tester.pumpWidget(appUnder(
      home: const HomeScreen(),
      apiClient: apiClient,
      activeToken: activeToken,
      navigatorKey: navigatorKey,
      bannerService: bannerService,
    ));
    await tester.pump();

    final notificationCenter = navigatorKey.currentContext!.read<NotificationCenterProvider>();
    notificationCenter.recordStatusChange(
      buildToken(id: 'token-a', queueId: 'queue-a', serial: 'A002', status: 'CALLED'),
      queueName: 'Pharmacy',
    );
    await tester.pump();

    expect(notificationCenter.notifications, hasLength(1));
    expect(notificationCenter.unreadCount, 1);

    bannerService.dispose();
  });

  testWidgets('a duplicate of the same logical event produces one inbox entry and no second banner',
      (tester) async {
    final navigatorKey = GlobalKey<NavigatorState>();
    final bannerService = ForegroundBannerService(navigatorKey);
    final apiClient = ApiClient(baseUrl: 'http://localhost:4000');
    final activeToken = ActiveTokenProvider(
      tokenRepository: TokenRepository(apiService: TokenApiService(apiClient), socketService: SocketService()),
      storage: ActiveTokenStorageService(),
    );

    await tester.pumpWidget(appUnder(
      home: const HomeScreen(),
      apiClient: apiClient,
      activeToken: activeToken,
      navigatorKey: navigatorKey,
      bannerService: bannerService,
    ));
    await tester.pump();

    final notificationCenter = navigatorKey.currentContext!.read<NotificationCenterProvider>();
    final firstToken = buildToken(id: 'token-a', queueId: 'queue-a', serial: 'A002', status: 'CALLED');
    notificationCenter.recordStatusChange(firstToken, queueName: 'Pharmacy');
    await tester.pump();
    // Dismiss the first banner before the "duplicate" arrives, so a second
    // banner (there should be none) is unambiguous rather than mistaken for
    // the first one still on screen.
    await tester.tap(find.byIcon(Icons.close));
    await tester.pump();

    // Simulates the same event arriving again via a second channel.
    notificationCenter.recordStatusChange(firstToken, queueName: 'Pharmacy');
    await tester.pump();

    expect(notificationCenter.notifications, hasLength(1));
    expect(find.text('Your token was called'), findsNothing);

    bannerService.dispose();
  });

  testWidgets('two legitimate different events each produce their own entry and banner',
      (tester) async {
    final navigatorKey = GlobalKey<NavigatorState>();
    final bannerService = ForegroundBannerService(navigatorKey);
    final apiClient = ApiClient(baseUrl: 'http://localhost:4000');
    final activeToken = ActiveTokenProvider(
      tokenRepository: TokenRepository(apiService: TokenApiService(apiClient), socketService: SocketService()),
      storage: ActiveTokenStorageService(),
    );

    await tester.pumpWidget(appUnder(
      home: const HomeScreen(),
      apiClient: apiClient,
      activeToken: activeToken,
      navigatorKey: navigatorKey,
      bannerService: bannerService,
    ));
    await tester.pump();

    final notificationCenter = navigatorKey.currentContext!.read<NotificationCenterProvider>();
    notificationCenter.recordStatusChange(
      buildToken(id: 'token-a', queueId: 'queue-a', serial: 'A002', status: 'CALLED'),
      queueName: 'Pharmacy',
    );
    await tester.pump();
    expect(find.text('Your token was called'), findsOneWidget);

    notificationCenter.recordStatusChange(
      buildToken(id: 'token-a', queueId: 'queue-a', serial: 'A002', status: 'IN_PROGRESS'),
      queueName: 'Pharmacy',
    );
    await tester.pump();

    // Both are already recorded — nothing is lost — but the banner is
    // persistent now, so the second one queues behind the first rather than
    // replacing it or stacking visually.
    expect(notificationCenter.notifications, hasLength(2));
    expect(find.text('Your token was called'), findsOneWidget);
    expect(find.text('Your service has started'), findsNothing);

    await tester.tap(find.byIcon(Icons.close));
    await tester.pump();

    expect(find.text('Your token was called'), findsNothing);
    expect(find.text('Your service has started'), findsOneWidget);

    bannerService.dispose();
  });

  testWidgets('resuming does not replay a banner for a notification restored from storage',
      (tester) async {
    // Seed storage exactly as a previous session would have left it.
    final seed = NotificationCenterProvider(storage: NotificationCenterStorageService());
    seed.recordStatusChange(
      buildToken(id: 'token-a', queueId: 'queue-a', serial: 'A002', status: 'CALLED'),
      queueName: 'Pharmacy',
    );
    // A bare `Future.delayed` never resolves inside widget tests' FakeAsync
    // zone — only pumping the tester advances that fake clock.
    await tester.pump();

    final navigatorKey = GlobalKey<NavigatorState>();
    final bannerService = ForegroundBannerService(navigatorKey);
    final apiClient = ApiClient(baseUrl: 'http://localhost:4000');
    final activeToken = ActiveTokenProvider(
      tokenRepository: TokenRepository(apiService: TokenApiService(apiClient), socketService: SocketService()),
      storage: ActiveTokenStorageService(),
    );

    await tester.pumpWidget(appUnder(
      home: const HomeScreen(),
      apiClient: apiClient,
      activeToken: activeToken,
      navigatorKey: navigatorKey,
      bannerService: bannerService,
    ));
    await tester.pump();

    // The restored entry is present in the inbox...
    expect(
      navigatorKey.currentContext!.read<NotificationCenterProvider>().notifications,
      hasLength(1),
    );
    // ...but starting the app never re-shows it as a fresh banner.
    expect(find.text('Your token was called'), findsNothing);

    bannerService.dispose();
  });

  testWidgets('no PII appears in the rendered banner text', (tester) async {
    final navigatorKey = GlobalKey<NavigatorState>();
    final bannerService = ForegroundBannerService(navigatorKey);
    final apiClient = ApiClient(baseUrl: 'http://localhost:4000');
    final activeToken = ActiveTokenProvider(
      tokenRepository: TokenRepository(apiService: TokenApiService(apiClient), socketService: SocketService()),
      storage: ActiveTokenStorageService(),
    );

    await tester.pumpWidget(appUnder(
      home: const HomeScreen(),
      apiClient: apiClient,
      activeToken: activeToken,
      navigatorKey: navigatorKey,
      bannerService: bannerService,
    ));
    await tester.pump();

    navigatorKey.currentContext!.read<NotificationCenterProvider>().recordStatusChange(
          buildToken(id: 'token-a', queueId: 'queue-a', serial: 'A002', status: 'CALLED'),
          queueName: 'Pharmacy',
        );
    await tester.pump();

    final texts = tester.widgetList<Text>(find.byType(Text)).map((t) => t.data ?? '').join(' ');
    expect(texts, isNot(contains('@')));
    expect(texts, isNot(contains('token-a')));

    bannerService.dispose();
  });
}

extension TokenJson on LiveQueueToken {
  Map<String, dynamic> toJson() => {
        'id': id,
        'queueId': queueId,
        'serviceId': serviceId,
        'serialNumber': serialNumber,
        'status': status.name.toUpperCase() == 'INPROGRESS' ? 'IN_PROGRESS' : status.name.toUpperCase(),
        'formData': formData,
        'position': position,
        'estimatedWaitMinutes': estimatedWaitMinutes,
        'counter': null,
        'createdAt': createdAt.toIso8601String(),
        'calledAt': calledAt?.toIso8601String(),
        'startedAt': startedAt?.toIso8601String(),
        'completedAt': completedAt?.toIso8601String(),
        'skippedAt': skippedAt?.toIso8601String(),
      };
}
