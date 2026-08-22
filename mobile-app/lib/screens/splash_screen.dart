import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/notification_preferences_provider.dart';
import '../repositories/device_repository.dart';
import '../services/fcm_service.dart';
import '../services/notification_service.dart';
import 'home_screen.dart';

/// Performs one-time startup work (local notification setup, best-effort
/// FCM init, device registration) before showing Home. None of this is
/// business logic a widget should own long-term — it just needs somewhere
/// to run once at launch.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _bootstrap());
  }

  Future<void> _bootstrap() async {
    final notificationService = context.read<NotificationService>();
    final fcmService = context.read<FcmService>();
    final deviceRepository = context.read<DeviceRepository>();
    final preferencesProvider = context.read<NotificationPreferencesProvider>();

    await notificationService.initialize();
    // Best-effort: never blocks startup if unavailable (see FcmService doc).
    await fcmService.initialize();
    // So TokenConfirmationScreen/TokenTrackingProvider read real saved
    // preferences (not just in-memory defaults) once the customer joins.
    await preferencesProvider.load();
    // Best-effort: a failed registration here just means it retries the
    // next time the customer actually tries to join a queue.
    try {
      await deviceRepository.ensureRegisteredDevice();
    } catch (_) {
      // Ignored here deliberately — QueueJoinProvider.submitJoin() also
      // calls ensureRegisteredDevice() and will surface any real failure
      // to the user at the point where it actually matters.
    }

    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const HomeScreen()),
    );
  }

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.groups_2_outlined, size: 72, color: Colors.indigo),
            SizedBox(height: 16),
            Text('LiveQueue', style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold)),
            SizedBox(height: 24),
            CircularProgressIndicator(),
          ],
        ),
      ),
    );
  }
}
