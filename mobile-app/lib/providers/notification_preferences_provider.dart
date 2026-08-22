import 'package:flutter/foundation.dart';

import '../models/notification_preferences.dart';
import '../repositories/notification_preferences_repository.dart';
import '../services/notification_service.dart';

class NotificationPreferencesProvider extends ChangeNotifier {
  NotificationPreferencesProvider({
    required NotificationPreferencesRepository repository,
    required NotificationService notificationService,
  })  : _repository = repository,
        _notificationService = notificationService;

  final NotificationPreferencesRepository _repository;
  final NotificationService _notificationService;

  NotificationPreferences preferences = const NotificationPreferences();
  bool isLoading = false;
  bool permissionGranted = false;

  Future<void> load() async {
    isLoading = true;
    notifyListeners();
    try {
      preferences = await _repository.load();
    } finally {
      isLoading = false;
      notifyListeners();
    }
  }

  Future<void> requestPermission() async {
    permissionGranted = await _notificationService.requestPermission();
    notifyListeners();
  }

  Future<void> setReminderMinutes(int minutes) async {
    preferences = preferences.copyWith(reminderMinutesBeforeTurn: minutes);
    notifyListeners();
    await _repository.save(preferences);
  }

  Future<void> setSoundEnabled(bool enabled) async {
    preferences = preferences.copyWith(soundEnabled: enabled);
    notifyListeners();
    await _repository.save(preferences);
  }

  Future<void> setVibrationEnabled(bool enabled) async {
    preferences = preferences.copyWith(vibrationEnabled: enabled);
    notifyListeners();
    await _repository.save(preferences);
  }
}
