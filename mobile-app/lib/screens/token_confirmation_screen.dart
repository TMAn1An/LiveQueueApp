import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/notification_preferences_provider.dart';
import '../providers/queue_join_provider.dart';
import '../providers/token_tracking_provider.dart';
import 'live_tracking_screen.dart';

/// Spec 4.3: "App displays token number + position -> Live tracking starts."
class TokenConfirmationScreen extends StatelessWidget {
  const TokenConfirmationScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final token = context.watch<QueueJoinProvider>().createdToken;

    if (token == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Token')),
        body: const Center(child: Text('No token to display.')),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text("You're In!"), automaticallyImplyLeading: false),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.check_circle, size: 72, color: Colors.green),
              const SizedBox(height: 16),
              Text('Your Token', style: Theme.of(context).textTheme.titleMedium),
              Text(
                token.serialNumber,
                style: Theme.of(context).textTheme.displayMedium?.copyWith(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              if (token.position != null) Text('Position: ${token.position}'),
              if (token.estimatedWaitMinutes != null)
                Text('Estimated Wait: ${token.estimatedWaitMinutes} minutes'),
              const SizedBox(height: 32),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () {
                    final preferences = context.read<NotificationPreferencesProvider>().preferences;
                    context.read<TokenTrackingProvider>().start(token, preferences);
                    Navigator.of(context).pushReplacement(
                      MaterialPageRoute(builder: (_) => const LiveTrackingScreen()),
                    );
                  },
                  child: const Text('Track My Token'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
