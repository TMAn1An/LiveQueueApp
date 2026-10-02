import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../models/notification_preferences.dart';
import '../models/token_reminder_status.dart';
import '../providers/active_token_provider.dart';
import '../providers/notification_preferences_provider.dart';
import '../utils/open_active_token.dart';
import '../widgets/reminder_caution.dart';

/// Spec section 7.18: the reminder time (minimum 2 minutes; 2/5/10/15/20
/// suggested), sound/vibration toggles.
///
/// ADR-062: the reminder time is the customer's own choice when they make
/// one — a suggested value or any whole number of minutes — and otherwise
/// each queue's default.
class NotificationSettingsScreen extends StatefulWidget {
  const NotificationSettingsScreen({super.key});

  @override
  State<NotificationSettingsScreen> createState() => _NotificationSettingsScreenState();
}

/// Radio values that are not a number of minutes.
const int _queueDefaultOption = 0;
const int _customOption = -1;

class _NotificationSettingsScreenState extends State<NotificationSettingsScreen>
    with WidgetsBindingObserver {
  final _customController = TextEditingController();
  final _customFocus = FocusNode();

  /// True once the customer picks "Custom" — before they have typed a valid
  /// number, when there is nothing yet to save.
  bool _customChosen = false;
  String? _customError;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final provider = context.read<NotificationPreferencesProvider>();
      await provider.load();
      if (!mounted) return;
      _showStoredCustomValue(provider.preferences);
      await provider.refreshPermission();
      await provider.refreshActiveTokens();
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _customController.dispose();
    _customFocus.dispose();
    super.dispose();
  }

  /// The permission can be changed in system settings while this screen is
  /// in the background; re-read it on the way back.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && mounted) {
      context.read<NotificationPreferencesProvider>().refreshPermission();
    }
  }

  void _showStoredCustomValue(NotificationPreferences prefs) {
    final minutes = prefs.reminderMinutesBeforeTurn;
    if (minutes == null || NotificationPreferences.presetReminderMinutes.contains(minutes)) return;
    setState(() {
      _customChosen = true;
      _customController.text = '$minutes';
    });
  }

  /// "Custom" is selected once the customer picks it, and also whenever the
  /// saved time is not one of the suggested values.
  bool _isCustom(NotificationPreferences prefs) {
    final minutes = prefs.reminderMinutesBeforeTurn;
    return _customChosen ||
        (minutes != null && !NotificationPreferences.presetReminderMinutes.contains(minutes));
  }

  int _selectedOption(NotificationPreferences prefs) {
    if (_isCustom(prefs)) return _customOption;
    return prefs.reminderMinutesBeforeTurn ?? _queueDefaultOption;
  }

  void _onOptionChanged(int? option) {
    if (option == null) return;
    final provider = context.read<NotificationPreferencesProvider>();

    if (option == _customOption) {
      setState(() => _customChosen = true);
      _customFocus.requestFocus();
      // A number may already be sitting in the field from an earlier visit.
      _applyCustom(_customController.text, reportEmpty: false);
      return;
    }

    setState(() {
      _customChosen = false;
      _customError = null;
    });
    _customFocus.unfocus();
    provider.setReminderMinutes(option == _queueDefaultOption ? null : option);
  }

  void _applyCustom(String input, {bool reportEmpty = true}) {
    if (input.trim().isEmpty && !reportEmpty) {
      setState(() => _customError = null);
      return;
    }
    final minutes = NotificationPreferences.parseReminderMinutes(input);
    if (minutes == null) {
      setState(
        () => _customError =
            'Enter a whole number from ${NotificationPreferences.minimumReminderMinutes} to '
            '${NotificationPreferences.maximumReminderMinutes}.',
      );
      return;
    }
    setState(() => _customError = null);
    final provider = context.read<NotificationPreferencesProvider>();
    if (provider.preferences.reminderMinutesBeforeTurn != minutes) {
      provider.setReminderMinutes(minutes);
    }
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<NotificationPreferencesProvider>();
    final prefs = provider.preferences;
    final cautions = provider.activeTokenReminders.where((r) => r.waitIsShorterThanReminder).toList();

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
                  groupValue: _selectedOption(prefs),
                  onChanged: _onOptionChanged,
                  child: Column(
                    children: [
                      const RadioListTile<int>(
                        title: Text("Queue's default"),
                        subtitle: Text('Use the time each queue has set'),
                        value: _queueDefaultOption,
                      ),
                      for (final minutes in NotificationPreferences.presetReminderMinutes)
                        RadioListTile<int>(title: Text('$minutes minutes'), value: minutes),
                      const RadioListTile<int>(title: Text('Custom'), value: _customOption),
                    ],
                  ),
                ),
                if (_isCustom(prefs))
                  Padding(
                    padding: const EdgeInsets.fromLTRB(72, 0, 16, 8),
                    child: TextField(
                      controller: _customController,
                      focusNode: _customFocus,
                      keyboardType: TextInputType.number,
                      inputFormatters: [
                        FilteringTextInputFormatter.digitsOnly,
                        LengthLimitingTextInputFormatter(3),
                      ],
                      textInputAction: TextInputAction.done,
                      decoration: InputDecoration(
                        labelText: 'Minutes before your turn',
                        helperText:
                            '${NotificationPreferences.minimumReminderMinutes}–'
                            '${NotificationPreferences.maximumReminderMinutes} minutes',
                        errorText: _customError,
                        suffixText: 'min',
                        border: const OutlineInputBorder(),
                      ),
                      onChanged: _applyCustom,
                      onSubmitted: _applyCustom,
                    ),
                  ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                  child: Text(
                    prefs.followsQueueDefault
                        ? 'You will be reminded at the time each queue has chosen.'
                        : 'Your choice replaces the time a queue has set, for every queue you join.',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
                for (final caution in cautions)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                    child: ReminderCaution(message: _cautionMessage(context, caution)),
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

  /// Names the token when the customer holds more than one, so it is clear
  /// which wait the caution is about.
  String _cautionMessage(BuildContext context, TokenReminderStatus caution) {
    final active = context.read<ActiveTokenProvider>();
    final summary = active.summaryFor(caution.tokenId);
    final which = summary != null && active.activeTokens.length > 1
        ? '${activeTokenSummaryLabel(summary)}: your'
        : 'Your';
    return '$which turn is about ${caution.estimatedWaitMinutes} min away — sooner than a '
        '${caution.reminderMinutes}-minute reminder, so it cannot give you that much notice. '
        'Please stay nearby.';
  }
}
