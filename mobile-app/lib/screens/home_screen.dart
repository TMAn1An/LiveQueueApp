import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/queue_join_provider.dart';
import '../theme/app_colors.dart';
import 'qr_scanner_screen.dart';
import 'settings_screen.dart';
import 'token_history_screen.dart';

/// Spec section 33 (mobile UX): "simple joining flow... avoid complex
/// onboarding." One primary action, two secondary links.
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        // Symbol + name rather than the full lockup: an app bar is far too
        // short for the wordmark artwork to stay legible.
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Image.asset('assets/images/livequeue-mark.png', height: 28),
            const SizedBox(width: 8),
            const Text('LiveQueue'),
          ],
        ),
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.qr_code_scanner, size: 96, color: AppColors.brandBlue),
              const SizedBox(height: 24),
              const Text(
                'Scan a queue QR code to join',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 18),
              ),
              const SizedBox(height: 32),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  icon: const Icon(Icons.qr_code_scanner),
                  label: const Text('Scan QR Code'),
                  onPressed: () {
                    context.read<QueueJoinProvider>().reset();
                    Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const QrScannerScreen()),
                    );
                  },
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  icon: const Icon(Icons.history),
                  label: const Text('Token History'),
                  onPressed: () {
                    Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const TokenHistoryScreen()),
                    );
                  },
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  icon: const Icon(Icons.settings),
                  label: const Text('Settings'),
                  onPressed: () {
                    Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const SettingsScreen()),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
