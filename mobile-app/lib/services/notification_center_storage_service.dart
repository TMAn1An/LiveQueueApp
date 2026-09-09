import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/app_notification.dart';

/// Device-local storage for the in-app Notification Center (V2 Product
/// Completion checkpoint, Part D). Not a new backend model: everything
/// shown here is already reachable from the token endpoints the app calls
/// anyway (see NotificationCenterProvider), so there is nothing server-side
/// to design an ownership/access model for — the same discipline this
/// checkpoint's mobile Notification Center follows generally.
class NotificationCenterStorageService {
  static const _key = 'app_notifications_v1';

  /// Kept small deliberately: this is a recent-activity feed, not an
  /// archive. Oldest entries are dropped first.
  static const maxEntries = 50;

  /// Never throws: unreadable local storage means "no notifications
  /// remembered", not a crash opening the inbox.
  Future<List<AppNotification>> readAll() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_key);
      if (raw == null) return [];

      final decoded = jsonDecode(raw);
      if (decoded is! List) return [];

      final notifications = <AppNotification>[];
      for (final entry in decoded) {
        if (entry is! Map<String, dynamic>) continue;
        try {
          notifications.add(AppNotification.fromJson(entry));
        } catch (_) {
          // Skip just this one entry.
        }
      }
      return notifications;
    } catch (_) {
      return [];
    }
  }

  Future<void> saveAll(List<AppNotification> notifications) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final capped = notifications.length > maxEntries
          ? notifications.sublist(notifications.length - maxEntries)
          : notifications;
      await prefs.setString(_key, jsonEncode(capped.map((n) => n.toJson()).toList()));
    } catch (_) {
      // A failed write costs the customer their notification history, not
      // anything about the tokens themselves — those are resynced fresh
      // from the backend regardless.
    }
  }
}
