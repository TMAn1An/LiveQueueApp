import 'package:flutter/foundation.dart';

import '../models/notification_preferences.dart';
import '../models/token_reminder_status.dart';
import '../repositories/notification_preferences_repository.dart';
import '../services/notification_service.dart';

/// Registers [preferences] with the backend for every token this
/// installation is currently queued with, and returns what the backend said
/// about each (ADR-062). Injected rather than owned: this provider knows
/// nothing about tokens, devices or the network.
typedef ReminderRegistration = Future<List<TokenReminderStatus>> Function(
  NotificationPreferences preferences,
);

class NotificationPreferencesProvider extends ChangeNotifier {
  NotificationPreferencesProvider({
    required NotificationPreferencesRepository repository,
    required NotificationService notificationService,
    this.registerWithActiveTokens,
    this.onChanged,
  })  : _repository = repository,
        _notificationService = notificationService;

  final NotificationPreferencesRepository _repository;
  final NotificationService _notificationService;

  /// Null in a context with no backend to tell (some widget tests).
  final ReminderRegistration? registerWithActiveTokens;

  /// Told after every change, so a token being tracked right now picks the
  /// new setting up immediately instead of the next time tracking starts.
  final void Function(NotificationPreferences preferences)? onChanged;

  NotificationPreferences preferences = const NotificationPreferences();
  bool isLoading = false;
  bool permissionGranted = false;

  /// What the backend last said about each active token under the current
  /// preferences — in particular, whether a turn is already closer than the
  /// reminder time. Empty until [refreshActiveTokens] has run.
  List<TokenReminderStatus> activeTokenReminders = const [];

  Future<void> load() async {
    isLoading = true;
    notifyListeners();
    try {
      preferences = await _repository.load();
      await _applyAlertPreferences();
    } finally {
      isLoading = false;
      notifyListeners();
    }
  }

  /// Reads the notification permission as it currently stands — without
  /// asking. The setting can change outside the app, so the screen showing
  /// it calls this when it opens and whenever the app is resumed.
  Future<void> refreshPermission() async {
    final granted = await _notificationService.areNotificationsEnabled();
    if (granted == permissionGranted) return;
    permissionGranted = granted;
    notifyListeners();
  }

  Future<void> requestPermission() async {
    permissionGranted = await _notificationService.requestPermission();
    notifyListeners();
  }

  /// [minutes] of null means "use each queue's default".
  Future<void> setReminderMinutes(int? minutes) async {
    await _update(preferences.copyWith(reminderMinutesBeforeTurn: minutes));
  }

  Future<void> setSoundEnabled(bool enabled) async {
    await _update(preferences.copyWith(soundEnabled: enabled));
  }

  Future<void> setVibrationEnabled(bool enabled) async {
    await _update(preferences.copyWith(vibrationEnabled: enabled));
  }

  /// Registers the current preferences with the backend for every active
  /// token and records its answers. Never throws: an unreachable backend
  /// leaves the previous answers in place.
  Future<void> refreshActiveTokens() async {
    final register = registerWithActiveTokens;
    if (register == null) return;
    final requested = preferences;
    try {
      final statuses = await register(requested);
      // A newer change overtook this one; its own answer is on the way.
      if (!identical(requested, preferences)) return;
      activeTokenReminders = statuses;
      notifyListeners();
    } catch (_) {
      // Keep what was there.
    }
  }

  Future<void> _update(NotificationPreferences updated) async {
    preferences = updated;
    notifyListeners();
    await _repository.save(updated);
    await _applyAlertPreferences();
    onChanged?.call(updated);
    await refreshActiveTokens();
  }

  Future<void> _applyAlertPreferences() async {
    try {
      await _notificationService.applyAlertPreferences(
        soundEnabled: preferences.soundEnabled,
        vibrationEnabled: preferences.vibrationEnabled,
      );
    } catch (_) {
      // A channel that could not be created must not block saving a setting.
    }
  }
}
