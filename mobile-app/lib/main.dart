import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:provider/provider.dart';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'firebase_options.dart';
import 'services/fcm_service.dart';

import 'models/app_notification.dart';
import 'models/live_queue_token.dart';
import 'providers/history_provider.dart';
import 'providers/notification_center_provider.dart';
import 'providers/notification_preferences_provider.dart';
import 'providers/active_token_provider.dart';
import 'providers/queue_join_provider.dart';
import 'providers/token_tracking_provider.dart';
import 'repositories/app_version_repository.dart';
import 'repositories/device_repository.dart';
import 'repositories/history_repository.dart';
import 'repositories/notification_preferences_repository.dart';
import 'repositories/email_verification_repository.dart';
import 'repositories/queue_repository.dart';
import 'repositories/token_repository.dart';
import 'screens/splash_screen.dart';
import 'services/active_token_storage_service.dart';
import 'services/api_client.dart';
import 'services/app_version_api_service.dart';
import 'services/device_api_service.dart';
import 'services/device_identity_service.dart';
import 'services/history_storage_service.dart';
import 'services/notification_center_storage_service.dart';
import 'services/notification_service.dart';
import 'services/email_verification_api_service.dart';
import 'services/foreground_banner_service.dart';
import 'services/preferences_storage_service.dart';
import 'services/queue_api_service.dart';
import 'services/socket_service.dart';
import 'services/token_api_service.dart';
import 'theme/app_theme.dart';
import 'utils/app_navigation.dart';
import 'utils/open_active_token.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Firebase/FCM is optional infrastructure — a failure here (network,
  // misconfiguration) must never stop the rest of the app (REST, Socket.io,
  // local notifications) from starting. Registered here, early and once,
  // specifically so the background message handler is live before the app
  // could plausibly receive a push; FcmService.initialize() (called later,
  // from SplashScreen) re-checks Firebase.apps before ever calling
  // initializeApp again, so this is the only place that can fail this way,
  // not a duplicate-init race with FcmService.
  try {
    await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
  } catch (err) {
    if (kDebugMode) {
      debugPrint('Firebase initialization failed (continuing without it): $err');
    }
  }

  runApp(const LiveQueueApp());
}

/// Composition root: wires services -> repositories -> providers exactly
/// once. Nothing below this reaches out and constructs its own
/// dependencies — everything is injected (CLAUDE.md Flutter rules / the
/// project's layered architecture).
class LiveQueueApp extends StatelessWidget {
  const LiveQueueApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        // Services
        Provider<ApiClient>(create: (_) => ApiClient()),
        Provider<SocketService>(
          create: (_) => SocketService(),
          dispose: (_, s) => s.dispose(),
        ),
        Provider<DeviceIdentityService>(create: (_) => DeviceIdentityService()),
        Provider<NotificationService>(create: (_) => NotificationService()),
        Provider<FcmService>(
          create: (context) =>
              FcmService(notificationService: context.read<NotificationService>()),
          dispose: (_, s) => s.dispose(),
        ),
        Provider<HistoryStorageService>(create: (_) => HistoryStorageService()),
        Provider<ActiveTokenStorageService>(create: (_) => ActiveTokenStorageService()),
        Provider<NotificationCenterStorageService>(
          create: (_) => NotificationCenterStorageService(),
        ),
        // V2 Physical Validation + Foreground Notification checkpoint:
        // the one presenter for the small "🔔 A002 has been called" banner
        // that can appear over any screen. Disposed with the app, same as
        // every other long-lived service here.
        Provider<ForegroundBannerService>(
          create: (_) => ForegroundBannerService(navigatorKey),
          dispose: (_, s) => s.dispose(),
        ),
        Provider<PreferencesStorageService>(
          create: (_) => PreferencesStorageService(),
        ),
        Provider<QueueApiService>(
          create: (context) => QueueApiService(context.read<ApiClient>()),
        ),
        Provider<EmailVerificationApiService>(
          create: (context) => EmailVerificationApiService(context.read<ApiClient>()),
        ),
        Provider<DeviceApiService>(
          create: (context) => DeviceApiService(context.read<ApiClient>()),
        ),
        Provider<TokenApiService>(
          create: (context) => TokenApiService(context.read<ApiClient>()),
        ),
        Provider<AppVersionApiService>(
          create: (context) => AppVersionApiService(context.read<ApiClient>()),
        ),

        // Repositories
        Provider<QueueRepository>(
          create: (context) =>
              QueueRepository(apiService: context.read<QueueApiService>()),
        ),
        Provider<EmailVerificationRepository>(
          create: (context) => EmailVerificationRepository(
            apiService: context.read<EmailVerificationApiService>(),
          ),
        ),
        Provider<DeviceRepository>(
          create: (context) => DeviceRepository(
            identityService: context.read<DeviceIdentityService>(),
            apiService: context.read<DeviceApiService>(),
          ),
        ),
        Provider<TokenRepository>(
          create: (context) => TokenRepository(
            apiService: context.read<TokenApiService>(),
            socketService: context.read<SocketService>(),
          ),
        ),
        Provider<HistoryRepository>(
          create: (context) => HistoryRepository(
            storageService: context.read<HistoryStorageService>(),
          ),
        ),
        Provider<NotificationPreferencesRepository>(
          create: (context) => NotificationPreferencesRepository(
            storageService: context.read<PreferencesStorageService>(),
          ),
        ),
        Provider<AppVersionRepository>(
          create: (context) => AppVersionRepository(
            apiService: context.read<AppVersionApiService>(),
          ),
        ),

        // App-root ViewModels. QueueJoinProvider and TokenTrackingProvider
        // are reused across the screens of a single flow (see their own
        // doc comments) rather than recreated per screen.
        ChangeNotifierProvider<QueueJoinProvider>(
          create: (context) => QueueJoinProvider(
            queueRepository: context.read<QueueRepository>(),
            tokenRepository: context.read<TokenRepository>(),
            deviceRepository: context.read<DeviceRepository>(),
            historyRepository: context.read<HistoryRepository>(),
            emailVerificationRepository: context.read<EmailVerificationRepository>(),
          ),
        ),
        // V2 Product Completion checkpoint, Part D: local-only, read at
        // startup same as the other on-device stores — never blocks Home.
        ChangeNotifierProvider<NotificationCenterProvider>(
          create: (context) => NotificationCenterProvider(
            storage: context.read<NotificationCenterStorageService>(),
            // V2 Physical Validation + Foreground Notification checkpoint:
            // every genuinely new entry also raises the foreground banner,
            // except the join itself — a successful join already has its
            // own immediate confirmation screen, and a banner on top of it
            // would just be a redundant, unnecessary second popup for the
            // exact same news the customer is already looking at.
            onNotificationAdded: (notification) {
              if (notification.kind == NotificationKind.joined) return;
              final navContext = navigatorKey.currentContext;
              if (navContext == null) return;
              context.read<ForegroundBannerService>().show(
                    title: notification.title,
                    body: notification.body,
                    onTap: () => openActiveToken(navContext, notification.tokenId),
                  );
            },
          )..load(),
        ),
        // ADR-036: outlives every screen, so a running token stays reachable
        // however the customer moves around the app.
        ChangeNotifierProvider<ActiveTokenProvider>(
          create: (context) => ActiveTokenProvider(
            tokenRepository: context.read<TokenRepository>(),
            storage: context.read<ActiveTokenStorageService>(),
            // V2 Product Completion checkpoint, Part D: a resync of any
            // remembered token — not only the one currently open in Live
            // Tracking — records a Notification Center entry when its
            // status genuinely changed, which is what makes a status change
            // in a token the customer isn't looking at still show up here.
            onTokenStatusChanged: (token, {required queueName}) => context
                .read<NotificationCenterProvider>()
                .recordStatusChange(token, queueName: queueName),
          )..restore(),
        ),
        ChangeNotifierProvider<TokenTrackingProvider>(
          create: (context) => TokenTrackingProvider(
            tokenRepository: context.read<TokenRepository>(),
            deviceRepository: context.read<DeviceRepository>(),
            historyRepository: context.read<HistoryRepository>(),
            notificationService: context.read<NotificationService>(),
            fcmService: context.read<FcmService>(),
          )
            // ADR-036: a finished visit stops being the active token and
            // becomes history. Nothing about navigation triggers this — only
            // the token actually reaching a terminal state does.
            ..onTokenSettled = ((LiveQueueToken token) {
              context.read<ActiveTokenProvider>().syncFromTracked(token);
            })
            // V2 Product Completion checkpoint, Part D: the actively-tracked
            // token's own transitions, ETA changes and reminders, recorded
            // to the Notification Center the moment they happen while the
            // app is open — the fast path alongside the resync-based one
            // above, which is what catches everything else.
            ..onStatusNotification = ((LiveQueueToken token, {required String queueName}) {
              context
                  .read<NotificationCenterProvider>()
                  .recordStatusChange(token, queueName: queueName);
            })
            ..onEtaNotification = (({
              required String tokenId,
              required String serialNumber,
              required String queueName,
              required String body,
            }) {
              context.read<NotificationCenterProvider>().recordEtaChanged(
                    tokenId: tokenId,
                    serialNumber: serialNumber,
                    queueName: queueName,
                    body: body,
                  );
            })
            ..onReminderNotification = (({
              required String tokenId,
              required String serialNumber,
              required String queueName,
              required int estimatedWaitMinutes,
            }) {
              context.read<NotificationCenterProvider>().recordReminder(
                    tokenId: tokenId,
                    serialNumber: serialNumber,
                    queueName: queueName,
                    estimatedWaitMinutes: estimatedWaitMinutes,
                  );
            }),
        ),
        ChangeNotifierProvider<HistoryProvider>(
          create: (context) => HistoryProvider(
            historyRepository: context.read<HistoryRepository>(),
          ),
        ),
        ChangeNotifierProvider<NotificationPreferencesProvider>(
          create: (context) => NotificationPreferencesProvider(
            repository: context.read<NotificationPreferencesRepository>(),
            notificationService: context.read<NotificationService>(),
          ),
        ),
      ],
      child: MaterialApp(
        navigatorKey: navigatorKey,
        title: 'LiveQueue',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.light,
        home: const SplashScreen(),
      ),
    );
  }
}
