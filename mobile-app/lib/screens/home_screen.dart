import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/active_token_summary.dart';
import '../providers/active_token_provider.dart';
import '../providers/queue_join_provider.dart';
import '../utils/open_active_token.dart';
import '../widgets/app_drawer.dart';
import '../widgets/dev_backend_banner.dart';
import '../widgets/notification_bell.dart';
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
    final activeTokens = context.watch<ActiveTokenProvider>().activeTokens;

    return Scaffold(
      drawer: const AppDrawer(),
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
        // V2 Product Completion checkpoint, Part D.
        actions: const [NotificationBell()],
        // A strip under the app bar, above everything else on the first
        // screen — because it explains every other thing that is about to
        // fail. Occupies no height at all in a configured build.
        bottom: const DevBackendBanner(),
      ),
      // A scrollable, height-constrained Center rather than a bare one: with
      // more than one active token the content can legitimately exceed a
      // short screen's height, and unlike the single-button case that
      // overflow must not be silently clipped (V2 Product Completion
      // checkpoint, Part A). Content that fits is still centered exactly as
      // before — ConstrainedBox only sets a *minimum* height equal to the
      // viewport, so Center has room to centre in without ever being forced
      // to grow past what actually fits.
      body: LayoutBuilder(
        builder: (context, constraints) => SingleChildScrollView(
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: constraints.maxHeight),
            child: Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.qr_code_scanner,
                      size: 96,
                      color: AppColors.brandBlue,
                    ),
                    const SizedBox(height: 24),
                    const Text(
                      'Scan a queue QR code to join',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 18),
                    ),
                    const SizedBox(height: 32),
                    // ADR-036, extended by the V2 Product Completion checkpoint:
                    // the way back into every queue the customer is already
                    // standing in, not just the most recently joined one. A single
                    // remembered token keeps the one convenient button; two or
                    // more get their own short, tappable list instead of one
                    // button that could only ever point at one of them.
                    ..._activeTokenSection(context, activeTokens),
                    SizedBox(
                      width: double.infinity,
                      child: activeTokens.isNotEmpty
                          ? OutlinedButton.icon(
                              icon: const Icon(Icons.qr_code_scanner),
                              label: const Text('Scan QR Code'),
                              onPressed: () {
                                context.read<QueueJoinProvider>().reset();
                                Navigator.of(context).push(
                                  MaterialPageRoute(
                                    builder: (_) => const QrScannerScreen(),
                                  ),
                                );
                              },
                            )
                          : FilledButton.icon(
                              icon: const Icon(Icons.qr_code_scanner),
                              label: const Text('Scan QR Code'),
                              onPressed: () {
                                context.read<QueueJoinProvider>().reset();
                                Navigator.of(context).push(
                                  MaterialPageRoute(
                                    builder: (_) => const QrScannerScreen(),
                                  ),
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
                            MaterialPageRoute(
                              builder: (_) => const TokenHistoryScreen(),
                            ),
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
                            MaterialPageRoute(
                              builder: (_) => const SettingsScreen(),
                            ),
                          );
                        },
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  List<Widget> _activeTokenSection(
    BuildContext context,
    List<ActiveTokenSummary> activeTokens,
  ) {
    if (activeTokens.isEmpty) return const [];

    if (activeTokens.length == 1) {
      final token = activeTokens.first;
      return [
        SizedBox(
          width: double.infinity,
          child: FilledButton.icon(
            icon: const Icon(Icons.confirmation_number),
            label: Text('Active Token · ${token.serialNumber}'),
            onPressed: () => openActiveToken(context, token.tokenId),
          ),
        ),
        const SizedBox(height: 12),
      ];
    }

    return [
      Align(
        alignment: Alignment.centerLeft,
        child: Text(
          'Active Tokens (${activeTokens.length})',
          style: Theme.of(context).textTheme.titleSmall,
        ),
      ),
      const SizedBox(height: 8),
      for (final token in activeTokens) ...[
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            icon: const Icon(Icons.confirmation_number_outlined),
            label: Text(activeTokenSummaryLabel(token)),
            onPressed: () => openActiveToken(context, token.tokenId),
          ),
        ),
        const SizedBox(height: 8),
      ],
      const SizedBox(height: 4),
    ];
  }
}
