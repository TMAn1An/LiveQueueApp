import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/notification_preferences.dart';

class PreferencesStorageService {
  static const _prefsKey = 'notification_preferences';

  /// Never throws: corrupted local storage must degrade to defaults rather
  /// than crash the app. Missing storage, malformed JSON, and a
  /// structurally-invalid top-level value (not a JSON object, or one whose
  /// fields have the wrong type) all fall back to [NotificationPreferences]'s
  /// defaults.
  Future<NotificationPreferences> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_prefsKey);
    if (raw == null || raw.isEmpty) return const NotificationPreferences();

    try {
      return NotificationPreferences.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {
      return const NotificationPreferences();
    }
  }

  Future<void> save(NotificationPreferences preferences) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefsKey, jsonEncode(preferences.toJson()));
  }
}
