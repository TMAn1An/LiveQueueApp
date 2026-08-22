import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'providers/history_provider.dart';
import 'providers/notification_preferences_provider.dart';
import 'providers/queue_join_provider.dart';
import 'providers/token_tracking_provider.dart';
import 'repositories/device_repository.dart';
import 'repositories/history_repository.dart';
import 'repositories/notification_preferences_repository.dart';
import 'repositories/queue_repository.dart';
import 'repositories/token_repository.dart';
import 'screens/splash_screen.dart';
import 'services/api_client.dart';
import 'services/device_api_service.dart';
import 'services/device_identity_service.dart';
import 'services/fcm_service.dart';
import 'services/history_storage_service.dart';
import 'services/notification_service.dart';
import 'services/preferences_storage_service.dart';
import 'services/queue_api_service.dart';
import 'services/socket_service.dart';
import 'services/token_api_service.dart';

void main() {
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
        Provider<SocketService>(create: (_) => SocketService(), dispose: (_, s) => s.dispose()),
        Provider<DeviceIdentityService>(create: (_) => DeviceIdentityService()),
        Provider<NotificationService>(create: (_) => NotificationService()),
        Provider<FcmService>(create: (_) => FcmService()),
        Provider<HistoryStorageService>(create: (_) => HistoryStorageService()),
        Provider<PreferencesStorageService>(create: (_) => PreferencesStorageService()),
        Provider<QueueApiService>(create: (context) => QueueApiService(context.read<ApiClient>())),
        Provider<DeviceApiService>(create: (context) => DeviceApiService(context.read<ApiClient>())),
        Provider<TokenApiService>(create: (context) => TokenApiService(context.read<ApiClient>())),

        // Repositories
        Provider<QueueRepository>(
          create: (context) => QueueRepository(apiService: context.read<QueueApiService>()),
        ),
        Provider<TokenRepository>(
          create: (context) => TokenRepository(
            apiService: context.read<TokenApiService>(),
            socketService: context.read<SocketService>(),
          ),
        ),
        Provider<DeviceRepository>(
          create: (context) => DeviceRepository(
            identityService: context.read<DeviceIdentityService>(),
            apiService: context.read<DeviceApiService>(),
          ),
        ),
        Provider<HistoryRepository>(
          create: (context) => HistoryRepository(storageService: context.read<HistoryStorageService>()),
        ),
        Provider<NotificationPreferencesRepository>(
          create: (context) =>
              NotificationPreferencesRepository(storageService: context.read<PreferencesStorageService>()),
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
          ),
        ),
        ChangeNotifierProvider<TokenTrackingProvider>(
          create: (context) => TokenTrackingProvider(
            tokenRepository: context.read<TokenRepository>(),
            historyRepository: context.read<HistoryRepository>(),
            notificationService: context.read<NotificationService>(),
          ),
        ),
        ChangeNotifierProvider<HistoryProvider>(
          create: (context) => HistoryProvider(historyRepository: context.read<HistoryRepository>()),
        ),
        ChangeNotifierProvider<NotificationPreferencesProvider>(
          create: (context) => NotificationPreferencesProvider(
            repository: context.read<NotificationPreferencesRepository>(),
            notificationService: context.read<NotificationService>(),
          ),
        ),
      ],
      child: MaterialApp(
        title: 'LiveQueue',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(colorSchemeSeed: Colors.indigo, useMaterial3: true),
        home: const SplashScreen(),
      ),
    );
  }
}
