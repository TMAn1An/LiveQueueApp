import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../repositories/device_repository.dart';
import '../repositories/history_repository.dart';
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

  Future<void> _clearHistory(BuildContext context) async {
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
