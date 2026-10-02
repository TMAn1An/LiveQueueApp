import '../models/notification_preferences.dart';
import '../models/token_reminder_status.dart';
import '../repositories/device_repository.dart';
import '../repositories/token_repository.dart';

/// Registers [preferences] with the backend for each of [tokenIds] and
/// returns the backend's answer for every one that succeeded (ADR-062).
///
/// Each token is independent: one that fails — it has since finished, or the
/// request was lost — is simply missing from the result and never stops the
/// others. A device that cannot be resolved at all yields an empty list.
Future<List<TokenReminderStatus>> registerReminderPreferences({
  required Iterable<String> tokenIds,
  required NotificationPreferences preferences,
  required DeviceRepository deviceRepository,
  required TokenRepository tokenRepository,
}) async {
  final ids = tokenIds.toList(growable: false);
  if (ids.isEmpty) return const [];

  final String deviceIdentifier;
  try {
    deviceIdentifier = await deviceRepository.ensureRegisteredDevice();
  } catch (_) {
    return const [];
  }

  final results = await Future.wait(
    ids.map((tokenId) async {
      try {
        return await tokenRepository.setNotificationPreferences(tokenId, deviceIdentifier, preferences);
      } catch (_) {
        return null;
      }
    }),
  );
  return results.whereType<TokenReminderStatus>().toList(growable: false);
}
