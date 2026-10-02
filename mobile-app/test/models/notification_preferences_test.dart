import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/models/notification_preferences.dart';

void main() {
  test("defaults: no reminder time of the customer's own, sound and vibration on", () {
    const prefs = NotificationPreferences();
    expect(prefs.reminderMinutesBeforeTurn, isNull);
    expect(prefs.followsQueueDefault, isTrue);
    expect(prefs.soundEnabled, isTrue);
    expect(prefs.vibrationEnabled, isTrue);
  });

  test('suggested reminder minutes match spec section 7.18 exactly', () {
    expect(NotificationPreferences.presetReminderMinutes, [2, 5, 10, 15, 20]);
    expect(NotificationPreferences.minimumReminderMinutes, 2);
    expect(NotificationPreferences.maximumReminderMinutes, 120);
  });

  group('effectiveReminderMinutes (ADR-062)', () {
    test("the customer's own time overrides the queue's default", () {
      const prefs = NotificationPreferences(reminderMinutesBeforeTurn: 4);
      expect(prefs.effectiveReminderMinutes(queueDefaultMinutes: 10), 4);
      expect(prefs.effectiveReminderMinutes(queueDefaultMinutes: 30), 4);
    });

    test("without one, the queue's default applies", () {
      const prefs = NotificationPreferences();
      expect(prefs.effectiveReminderMinutes(queueDefaultMinutes: 25), 25);
    });

    test('until the backend has reported the queue default, the usual one is assumed', () {
      const prefs = NotificationPreferences();
      expect(
        prefs.effectiveReminderMinutes(),
        NotificationPreferences.assumedQueueDefaultMinutes,
      );
    });
  });

  group('parseReminderMinutes — the custom field', () {
    test('accepts whole numbers from 2 to 120', () {
      expect(NotificationPreferences.parseReminderMinutes('2'), 2);
      expect(NotificationPreferences.parseReminderMinutes(' 37 '), 37);
      expect(NotificationPreferences.parseReminderMinutes('120'), 120);
    });

    test('refuses anything else', () {
      for (final input in ['', ' ', '0', '1', '121', '999', '-5', '2.5', '5 min', 'ten', '+5']) {
        expect(NotificationPreferences.parseReminderMinutes(input), isNull, reason: 'input "$input"');
      }
    });
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

  test('a custom time and "queue default" both survive a round trip', () {
    const custom = NotificationPreferences(reminderMinutesBeforeTurn: 37);
    expect(NotificationPreferences.fromJson(custom.toJson()).reminderMinutesBeforeTurn, 37);

    const followsQueue = NotificationPreferences();
    expect(NotificationPreferences.fromJson(followsQueue.toJson()).reminderMinutesBeforeTurn, isNull);
  });

  test('fromJson falls back to defaults for missing keys', () {
    final restored = NotificationPreferences.fromJson({});
    expect(restored.reminderMinutesBeforeTurn, isNull);
    expect(restored.soundEnabled, isTrue);
    expect(restored.vibrationEnabled, isTrue);
  });

  test('a time saved by an earlier version of the app is kept as the customer own choice', () {
    final restored = NotificationPreferences.fromJson({
      'reminderMinutesBeforeTurn': 5,
      'soundEnabled': true,
      'vibrationEnabled': true,
    });
    expect(restored.reminderMinutesBeforeTurn, 5);
    expect(restored.followsQueueDefault, isFalse);
  });

  test('a stored time outside the allowed range is not trusted', () {
    for (final stored in [0, 1, 121, -3, 'ten', 7.5]) {
      final restored = NotificationPreferences.fromJson({'reminderMinutesBeforeTurn': stored});
      expect(restored.reminderMinutesBeforeTurn, isNull, reason: 'stored $stored');
    }
  });

  group('copyWith', () {
    test('only changes the specified fields', () {
      const prefs = NotificationPreferences(reminderMinutesBeforeTurn: 15);
      final updated = prefs.copyWith(soundEnabled: false);
      expect(updated.soundEnabled, isFalse);
      expect(updated.reminderMinutesBeforeTurn, 15);
      expect(updated.vibrationEnabled, prefs.vibrationEnabled);
    });

    test("can return to the queue's default with an explicit null", () {
      const prefs = NotificationPreferences(reminderMinutesBeforeTurn: 15);
      expect(prefs.copyWith(reminderMinutesBeforeTurn: null).reminderMinutesBeforeTurn, isNull);
    });
  });
}
