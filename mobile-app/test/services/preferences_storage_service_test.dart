import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/models/notification_preferences.dart';
import 'package:mobile_app/services/preferences_storage_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('load() returns defaults when nothing has been saved', () async {
    final service = PreferencesStorageService();
    final prefs = await service.load();
    expect(prefs.reminderMinutesBeforeTurn, 5);
    expect(prefs.soundEnabled, isTrue);
    expect(prefs.vibrationEnabled, isTrue);
  });

  test('save() then load() round-trips the saved preferences', () async {
    final service = PreferencesStorageService();
    await service.save(
      const NotificationPreferences(
        reminderMinutesBeforeTurn: 20,
        soundEnabled: false,
        vibrationEnabled: false,
      ),
    );

    final prefs = await service.load();
    expect(prefs.reminderMinutesBeforeTurn, 20);
    expect(prefs.soundEnabled, isFalse);
    expect(prefs.vibrationEnabled, isFalse);
  });

  group('corrupted local storage', () {
    const prefsKey = 'notification_preferences'; // PreferencesStorageService's private key

    test('missing storage returns defaults', () async {
      final service = PreferencesStorageService();
      final prefs = await service.load();
      expect(prefs.reminderMinutesBeforeTurn, 5);
      expect(prefs.soundEnabled, isTrue);
      expect(prefs.vibrationEnabled, isTrue);
    });

    test('valid JSON loads correctly (regression baseline for the cases below)', () async {
      SharedPreferences.setMockInitialValues({
        prefsKey: '{"reminderMinutesBeforeTurn":10,"soundEnabled":false,"vibrationEnabled":true}',
      });
      final service = PreferencesStorageService();

      final prefs = await service.load();

      expect(prefs.reminderMinutesBeforeTurn, 10);
      expect(prefs.soundEnabled, isFalse);
    });

    test('malformed JSON (not parseable at all) returns defaults instead of throwing', () async {
      SharedPreferences.setMockInitialValues({prefsKey: '{not valid json!!'});
      final service = PreferencesStorageService();

      final prefs = await service.load();

      expect(prefs.reminderMinutesBeforeTurn, 5);
      expect(prefs.soundEnabled, isTrue);
      expect(prefs.vibrationEnabled, isTrue);
    });

    test('structurally invalid JSON (valid JSON but not an object) returns defaults instead of throwing', () async {
      SharedPreferences.setMockInitialValues({prefsKey: '["just", "a", "list"]'});
      final service = PreferencesStorageService();

      final prefs = await service.load();

      expect(prefs.reminderMinutesBeforeTurn, 5);
      expect(prefs.soundEnabled, isTrue);
      expect(prefs.vibrationEnabled, isTrue);
    });

    test('a wrongly-typed field returns defaults instead of throwing', () async {
      SharedPreferences.setMockInitialValues({
        prefsKey: '{"reminderMinutesBeforeTurn":"not a number","soundEnabled":true,"vibrationEnabled":true}',
      });
      final service = PreferencesStorageService();

      final prefs = await service.load();

      expect(prefs.reminderMinutesBeforeTurn, 5);
    });

    test('load() never throws for any of the corruption cases above', () async {
      for (final corrupt in ['not json', '{"a":', '[1,2,3]', 'null', '']) {
        SharedPreferences.setMockInitialValues({prefsKey: corrupt});
        final service = PreferencesStorageService();
        await expectLater(service.load(), completes);
      }
    });
  });
}
