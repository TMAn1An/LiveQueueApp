import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/models/notification_preferences.dart';

void main() {
  test('defaults match the spec (5 minute reminder, sound+vibration on)', () {
    const prefs = NotificationPreferences();
    expect(prefs.reminderMinutesBeforeTurn, 5);
    expect(prefs.soundEnabled, isTrue);
    expect(prefs.vibrationEnabled, isTrue);
  });

  test('allowed reminder minutes match spec section 7.18 exactly', () {
    expect(NotificationPreferences.allowedReminderMinutes, [2, 5, 10, 15, 20]);
    expect(NotificationPreferences.minimumReminderMinutes, 2);
  });

  test('toJson/fromJson round-trips exactly', () {
    const prefs = NotificationPreferences(
      reminderMinutesBeforeTurn: 15,
      soundEnabled: false,
      vibrationEnabled: true,
    );
    final restored = NotificationPreferences.fromJson(prefs.toJson());
    expect(restored.reminderMinutesBeforeTurn, 15);
    expect(restored.soundEnabled, isFalse);
    expect(restored.vibrationEnabled, isTrue);
  });

  test('fromJson falls back to defaults for missing keys', () {
    final restored = NotificationPreferences.fromJson({});
    expect(restored.reminderMinutesBeforeTurn, 5);
    expect(restored.soundEnabled, isTrue);
    expect(restored.vibrationEnabled, isTrue);
  });

  test('copyWith only changes the specified fields', () {
    const prefs = NotificationPreferences();
    final updated = prefs.copyWith(soundEnabled: false);
    expect(updated.soundEnabled, isFalse);
    expect(updated.reminderMinutesBeforeTurn, prefs.reminderMinutesBeforeTurn);
    expect(updated.vibrationEnabled, prefs.vibrationEnabled);
  });
}
