import 'package:shared_preferences/shared_preferences.dart';

/// Remembers which token this installation is currently in a queue with
/// (ADR-036).
///
/// Before this, the only reference to a running token was the tracking
/// screen's own state: leaving the screen tore down the provider and the
/// token became unreachable, even though the customer was still very much
/// standing in the line. Navigation is not a lifecycle event — a token ends
/// because staff served, skipped, or the customer cancelled it, never
/// because they pressed Back or looked at their history.
///
/// Only the id and a little context for the menu label are stored. The
/// authoritative state always comes from the backend on the way back in;
/// this is a pointer, not a cache of status.
class ActiveTokenStorageService {
  static const _tokenIdKey = 'active_token_id';
  static const _serialKey = 'active_token_serial';
  static const _queueNameKey = 'active_token_queue_name';

  /// Never throws: unreadable local storage should mean "no active token
  /// remembered", not a crash on startup.
  Future<ActiveTokenRef?> read() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final id = prefs.getString(_tokenIdKey);
      if (id == null || id.isEmpty) return null;
      return ActiveTokenRef(
        tokenId: id,
        serialNumber: prefs.getString(_serialKey) ?? '',
        queueName: prefs.getString(_queueNameKey) ?? '',
      );
    } catch (_) {
      return null;
    }
  }

  Future<void> save(ActiveTokenRef ref) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_tokenIdKey, ref.tokenId);
      await prefs.setString(_serialKey, ref.serialNumber);
      await prefs.setString(_queueNameKey, ref.queueName);
    } catch (_) {
      // A failed write costs the customer the shortcut back, not the token
      // itself — the backend still holds their place in the line.
    }
  }

  Future<void> clear() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_tokenIdKey);
      await prefs.remove(_serialKey);
      await prefs.remove(_queueNameKey);
    } catch (_) {
      // Ignored for the same reason as above.
    }
  }
}

/// The pointer itself. [serialNumber] and [queueName] exist only so the menu
/// can say "A023 · Pharmacy" before the resync lands.
class ActiveTokenRef {
  const ActiveTokenRef({
    required this.tokenId,
    required this.serialNumber,
    required this.queueName,
  });

  final String tokenId;
  final String serialNumber;
  final String queueName;
}
