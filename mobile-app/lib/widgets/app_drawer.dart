import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/active_token_provider.dart';
import '../providers/notification_center_provider.dart';
import '../providers/queue_join_provider.dart';
import '../screens/active_tokens_screen.dart';
import '../screens/home_screen.dart';
import '../screens/notification_center_screen.dart';
import '../screens/qr_scanner_screen.dart';
import '../screens/settings_screen.dart';
import '../screens/token_history_screen.dart';

/// The app's one navigation menu (ADR-036).
///
/// Its reason for existing is the Active Token entry: before this there was
/// no route back to a running token once the tracking screen was closed, so
/// leaving it felt like abandoning your place in the line. Every destination
/// here is reachable from every screen, and none of them ends a token.
class AppDrawer extends StatelessWidget {
  const AppDrawer({super.key});

  @override
  Widget build(BuildContext context) {
    final active = context.watch<ActiveTokenProvider>();
    final tokens = active.activeTokens;
    final unread = context.watch<NotificationCenterProvider>().unreadCount;

    return Drawer(
      child: SafeArea(
        child: ListView(
          padding: EdgeInsets.zero,
          children: [
            DrawerHeader(
              margin: EdgeInsets.zero,
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Image.asset('assets/images/livequeue-mark.png', height: 40),
                  const SizedBox(height: 12),
                  Text('LiveQueue', style: Theme.of(context).textTheme.titleLarge),
                ],
              ),
            ),
            ListTile(
              leading: const Icon(Icons.home_outlined),
              title: const Text('Home'),
              onTap: () => _goTo(context, const HomeScreen()),
            ),
            ListTile(
              leading: const Icon(Icons.qr_code_scanner),
              title: const Text('Scan / Join Queue'),
              onTap: () {
                Navigator.of(context).pop();
                context.read<QueueJoinProvider>().reset();
                Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const QrScannerScreen()),
                );
              },
            ),
            // Shown only when there is somewhere to go: an entry that opens
            // an empty screen is worse than no entry at all. Label and
            // subtitle both adapt to how many tokens are actually remembered
            // (V2 Product Completion checkpoint) — a lone token keeps the
            // singular wording and its own label; two or more collapse to a
            // count, since no single subtitle line could name them all.
            if (tokens.isNotEmpty)
              ListTile(
                leading: Icon(Icons.confirmation_number, color: Theme.of(context).colorScheme.primary),
                title: Text(tokens.length == 1 ? 'Active Token' : 'Active Tokens · ${tokens.length}'),
                subtitle: tokens.length == 1
                    ? Text(
                        [tokens.first.serialNumber, tokens.first.queueName]
                            .where((part) => part.isNotEmpty)
                            .join(' · '),
                      )
                    : null,
                onTap: () => _goTo(context, const ActiveTokensScreen()),
              ),
            ListTile(
              leading: const Icon(Icons.history),
              title: const Text('History'),
              onTap: () => _goTo(context, const TokenHistoryScreen()),
            ),
            // V2 Product Completion checkpoint, Part D.
            ListTile(
              leading: const Icon(Icons.notifications_outlined),
              title: Text(unread > 0 ? 'Notifications · $unread' : 'Notifications'),
              onTap: () => _goTo(context, const NotificationCenterScreen()),
            ),
            const Divider(),
            ListTile(
              leading: const Icon(Icons.settings),
              title: const Text('Settings'),
              onTap: () => _goTo(context, const SettingsScreen()),
            ),
          ],
        ),
      ),
    );
  }

  /// Closes the drawer, then pushes. Never replaces the stack: a customer who
  /// opens History from their tracking screen should be able to press Back
  /// and find it exactly where they left it.
  void _goTo(BuildContext context, Widget screen) {
    Navigator.of(context).pop();
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));
  }
}
