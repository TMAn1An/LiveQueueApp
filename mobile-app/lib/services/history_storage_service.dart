import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/history_entry.dart';
import '../models/live_queue_token.dart';

/// Local token history (spec section 7.20: "Keep the most recent 100
/// history records locally"). Device-local only — never synced, never sent
/// to the backend, matching the spec's "recommended limitation" verbatim.
class HistoryStorageService {
  static const _prefsKey = 'token_history';
  static const maxEntries = 100;

  /// Never throws: corrupted local storage must degrade to an empty history
  /// rather than crash the app. Missing storage returns `[]`. Malformed JSON
  /// or a structurally-invalid top-level value (not a JSON list) also
  /// returns `[]`. A single corrupted *entry* inside an otherwise-valid list
  /// is dropped individually rather than discarding the whole history.
  Future<List<HistoryEntry>> getAll() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_prefsKey);
    if (raw == null || raw.isEmpty) return [];

    final List<dynamic> decoded;
    try {
      decoded = jsonDecode(raw) as List<dynamic>;
    } catch (_) {
      return [];
    }

    final entries = <HistoryEntry>[];
    for (final item in decoded) {
      try {
        entries.add(HistoryEntry.fromJson(item as Map<String, dynamic>));
      } catch (_) {
        // Skip just this entry — one corrupted record shouldn't take down
        // the rest of the customer's history.
      }
    }
    return entries;
  }

  Future<void> add(HistoryEntry entry) async {
    final entries = await getAll();
    entries.removeWhere((e) => e.tokenId == entry.tokenId);
    entries.insert(0, entry);
    if (entries.length > maxEntries) {
      entries.removeRange(maxEntries, entries.length);
    }
    await _saveAll(entries);
  }

  /// Updates the stored final status for a token already in history (e.g.
  /// once a live-tracked token reaches a terminal state).
  Future<void> updateStatus(String tokenId, TokenStatus status) async {
    final entries = await getAll();
    final index = entries.indexWhere((e) => e.tokenId == tokenId);
    if (index == -1) return;
    entries[index] = entries[index].copyWith(finalStatus: status);
    await _saveAll(entries);
  }

  Future<void> _saveAll(List<HistoryEntry> entries) async {
    final prefs = await SharedPreferences.getInstance();
    final encoded = jsonEncode(entries.map((e) => e.toJson()).toList());
    await prefs.setString(_prefsKey, encoded);
  }

  Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_prefsKey);
  }
}
