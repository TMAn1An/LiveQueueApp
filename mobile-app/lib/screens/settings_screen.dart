import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../repositories/device_repository.dart';
import '../repositories/history_repository.dart';
import '../widgets/confirm_dialog.dart';
import 'notification_settings_screen.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  String? _deviceIdentifier;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      // Read-only display for support purposes; does not re-register.
      final id = await context.read<DeviceRepository>().ensureRegisteredDevice();
      if (mounted) setState(() => _deviceIdentifier = id);
    });
  }

  /// V2 Product Completion checkpoint, Part B: clearing history is a
  /// permanent local deletion and must ask first. Active tokens are a
  /// separate record (ActiveTokenStorageService, not HistoryStorageService)
  /// and are never touched by this — the dialog says so explicitly, since
  /// "history" and "the queue I'm currently standing in" are easy to
  /// conflate from the customer's side even though nothing here can affect
  /// the latter.
  Future<void> _clearHistory(BuildContext context) async {
    final confirmed = await showConfirmDialog(
      context,
      title: 'Clear token history?',
      message: 'This will remove your saved token history from this device. '
          'Active tokens will not be removed.',
      confirmLabel: 'Clear',
    );
    if (!confirmed) return;
    if (!context.mounted) return;

    await context.read<HistoryRepository>().clear();
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Token history cleared.')),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          ListTile(
            leading: const Icon(Icons.notifications_outlined),
            title: const Text('Notification Settings'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const NotificationSettingsScreen()),
            ),
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.delete_outline),
            title: const Text('Clear Token History'),
            onTap: () => _clearHistory(context),
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.smartphone_outlined),
            title: const Text('Device ID'),
            subtitle: Text(_deviceIdentifier ?? 'Loading…'),
          ),
        ],
      ),
    );
  }
}
