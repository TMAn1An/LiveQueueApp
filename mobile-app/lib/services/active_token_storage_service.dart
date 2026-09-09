import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/active_token_summary.dart';
import '../models/live_queue_token.dart';

/// Remembers every token this installation is currently (or may still be)
/// queued with (ADR-036, extended by the V2 Product Completion checkpoint).
///
/// Before ADR-036, the only reference to a running token was the tracking
/// screen's own state: leaving the screen tore down the provider and the
/// token became unreachable, even though the customer was still very much
/// standing in the line. Before this checkpoint, the pointer was singular —
/// joining a second queue silently discarded the first token's pointer, even
/// though the backend has always allowed the same installation to hold
/// active tokens in independent queues at once. Neither problem was a
/// backend defect; both were this storage layer modelling less than the
/// product actually supports.
///
/// Only an id and a little display context are stored per token — never
/// form data, an OTP, or a verification proof. The authoritative state
/// always comes from the backend on the way back in; this is a set of
/// pointers, not a cache of status.
class ActiveTokenStorageService {
  static const _tokensKey = 'active_tokens_v1';

  // Pre-checkpoint single-pointer keys. Read once, on the first `readAll()`
  // after an app update, and folded into the new collection so nobody's
  // in-progress token goes missing across the upgrade; never written again.
  static const _legacyTokenIdKey = 'active_token_id';
  static const _legacySerialKey = 'active_token_serial';
  static const _legacyQueueNameKey = 'active_token_queue_name';

  /// Never throws: unreadable or partially corrupt local storage should
  /// mean "as many tokens as could be read", never a crash on startup. One
  /// bad entry is skipped rather than discarding every other remembered
  /// token with it.
  Future<List<ActiveTokenSummary>> readAll() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_tokensKey);
      if (raw == null) {
        return _migrateLegacyPointer(prefs);
      }

      final decoded = jsonDecode(raw);
      if (decoded is! List) return [];

      final summaries = <ActiveTokenSummary>[];
      for (final entry in decoded) {
        if (entry is! Map<String, dynamic>) continue;
        try {
          summaries.add(ActiveTokenSummary.fromJson(entry));
        } catch (_) {
          // Skip just this one entry.
        }
      }
      return summaries;
    } catch (_) {
      return [];
    }
  }

  /// A pre-checkpoint install has at most one legacy pointer. Folded into
  /// the new format and the legacy keys cleared, so this runs at most once
  /// per installation.
  Future<List<ActiveTokenSummary>> _migrateLegacyPointer(SharedPreferences prefs) async {
    final legacyId = prefs.getString(_legacyTokenIdKey);
    if (legacyId == null || legacyId.isEmpty) return [];

    // Status/queueId are unknown until the first resync — TokenStatus.unknown
    // and an empty queueId are corrected the moment resyncAll() runs, which
    // the caller always does before showing anything as authoritative.
    final migrated = ActiveTokenSummary(
      tokenId: legacyId,
      serialNumber: prefs.getString(_legacySerialKey) ?? '',
      queueId: '',
      queueName: prefs.getString(_legacyQueueNameKey) ?? '',
      status: TokenStatus.unknown,
      lastKnownUpdatedAt: DateTime.fromMillisecondsSinceEpoch(0),
    );

    await _writeAll(prefs, [migrated]);
    await prefs.remove(_legacyTokenIdKey);
    await prefs.remove(_legacySerialKey);
    await prefs.remove(_legacyQueueNameKey);
    return [migrated];
  }

  /// Idempotent by [ActiveTokenSummary.tokenId]: adding a token already
  /// present replaces its entry in place rather than duplicating it. This is
  /// what makes joining a second queue additive — upserting Queue B's token
  /// can never touch Queue A's entry, because they carry different ids.
  Future<void> upsert(ActiveTokenSummary summary) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final current = await readAll();
      final next = [
        ...current.where((t) => t.tokenId != summary.tokenId),
        summary,
      ];
      await _writeAll(prefs, next);
    } catch (_) {
      // A failed write costs the customer the shortcut back, not the token
      // itself — the backend still holds their place in the line.
    }
  }

  /// Removes exactly one token by id. Every other remembered token is
  /// untouched — there is deliberately no "clear everything" operation on
  /// this path, so a single terminal token can never take unrelated ones
  /// down with it.
  Future<void> remove(String tokenId) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final current = await readAll();
      final next = current.where((t) => t.tokenId != tokenId).toList();
      if (next.length == current.length) return;
      await _writeAll(prefs, next);
    } catch (_) {
      // Ignored for the same reason as above.
    }
  }

  /// Replaces the whole remembered collection outright. Used only by the
  /// provider layer for whole-list persistence after a batch resync — never
  /// exposed as a "wipe everything" affordance.
  Future<void> saveAll(List<ActiveTokenSummary> summaries) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await _writeAll(prefs, summaries);
    } catch (_) {
      // Ignored for the same reason as above.
    }
  }

  Future<void> _writeAll(SharedPreferences prefs, List<ActiveTokenSummary> summaries) async {
    if (summaries.isEmpty) {
      await prefs.remove(_tokensKey);
      return;
    }
    await prefs.setString(_tokensKey, jsonEncode(summaries.map((t) => t.toJson()).toList()));
  }
}
