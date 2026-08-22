import 'package:shared_preferences/shared_preferences.dart';

import '../utils/uuid_generator.dart';

/// Generates and persists a per-installation device identifier (spec
/// section 7.19 / ADR-011: "The mobile app generates a UUID on first launch
/// and sends it in every request as a device identifier"). Not a
/// cryptographic secret and not a replacement for user identity — it's a
/// lightweight abuse-prevention handle, so a plain securely-random UUID v4
/// generated on-device is sufficient (no external id-issuance call needed).
class DeviceIdentityService {
  static const _prefsKey = 'device_identifier';

  Future<String> getOrCreateDeviceIdentifier() async {
    final prefs = await SharedPreferences.getInstance();
    final existing = prefs.getString(_prefsKey);
    if (existing != null && existing.isNotEmpty) {
      return existing;
    }

    final generated = generateUuidV4();
    await prefs.setString(_prefsKey, generated);
    return generated;
  }
}
