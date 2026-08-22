import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/notification_preferences.dart';
import '../providers/notification_preferences_provider.dart';

/// Spec section 7.18: reminder minutes (min 2; 2/5/10/15/20 suggested),
/// sound/vibration toggles.
class NotificationSettingsScreen extends StatefulWidget {
  const NotificationSettingsScreen({super.key});

  @override
  State<NotificationSettingsScreen> createState() => _NotificationSettingsScreenState();
}

class _NotificationSettingsScreenState extends State<NotificationSettingsScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<NotificationPreferencesProvider>().load();
    });
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<NotificationPreferencesProvider>();
    final prefs = provider.preferences;

    return Scaffold(
      appBar: AppBar(title: const Text('Notification Settings')),
      body: provider.isLoading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              children: [
                const Padding(
                  padding: EdgeInsets.fromLTRB(16, 16, 16, 4),
                  child: Text('Reminder before your turn', style: TextStyle(fontWeight: FontWeight.bold)),
                ),
                RadioGroup<int>(
                  groupValue: prefs.reminderMinutesBeforeTurn,
                  onChanged: (value) {
                    if (value != null) {
                      context.read<NotificationPreferencesProvider>().setReminderMinutes(value);
                    }
                  },
                  child: Column(
                    children: NotificationPreferences.allowedReminderMinutes
                        .map(
                          (minutes) => RadioListTile<int>(
                            title: Text('$minutes minutes'),
                            value: minutes,
                          ),
                        )
                        .toList(),
                  ),
                ),
                const Divider(),
                SwitchListTile(
                  title: const Text('Sound'),
                  value: prefs.soundEnabled,
                  onChanged: (value) =>
                      context.read<NotificationPreferencesProvider>().setSoundEnabled(value),
                ),
                SwitchListTile(
                  title: const Text('Vibration'),
                  value: prefs.vibrationEnabled,
                  onChanged: (value) =>
                      context.read<NotificationPreferencesProvider>().setVibrationEnabled(value),
                ),
                const Divider(),
                ListTile(
                  title: const Text('Enable notifications'),
                  subtitle: Text(provider.permissionGranted ? 'Enabled' : 'Tap to allow notifications'),
                  trailing: Icon(
                    provider.permissionGranted ? Icons.check_circle : Icons.chevron_right,
                    color: provider.permissionGranted ? Colors.green : null,
                  ),
                  onTap: () => context.read<NotificationPreferencesProvider>().requestPermission(),
                ),
              ],
            ),
    );
  }
}
