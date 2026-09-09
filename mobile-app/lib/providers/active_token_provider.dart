import 'package:flutter/foundation.dart';

import '../models/active_token_summary.dart';
import '../models/live_queue_token.dart';
import '../repositories/token_repository.dart';
import '../services/active_token_storage_service.dart';
import '../services/api_exception.dart';

/// Every token this installation currently has open across every queue, and
/// how to get back to each one (ADR-036, extended by the V2 Product
/// Completion checkpoint to hold more than one at a time).
///
/// Deliberately separate from [TokenTrackingProvider], which owns the live
/// socket session and only exists while the tracking screen is open for one
/// token. This one outlives every screen: it is what lets Home, the drawer
/// and a cold start know there are tokens to return to, in queues the
/// customer may not currently be looking at.
///
/// It never decides a token's fate. The backend is authoritative; this
/// resyncs each remembered id independently and either keeps the entry
/// (still active) or drops it (terminal — SKIPPED included, since Recall was
/// removed). A failure resyncing one token can never affect any other — see
/// [resyncAll].
class ActiveTokenProvider extends ChangeNotifier {
  ActiveTokenProvider({
    required TokenRepository tokenRepository,
    required ActiveTokenStorageService storage,
    this.onTokenStatusChanged,
  })  : _tokenRepository = tokenRepository,
        _storage = storage;

  final TokenRepository _tokenRepository;
  final ActiveTokenStorageService _storage;

  /// Told whenever a resync discovers a token's status genuinely changed
  /// since it was last recorded — the hook the in-app Notification Center
  /// uses to learn about a status change in a token that isn't the one
  /// currently open in Live Tracking (V2 Product Completion checkpoint,
  /// Part D). Never invoked for a token seen for the first time (nothing to
  /// compare against) or when the status is unchanged.
  final void Function(LiveQueueToken token, {required String queueName})? onTokenStatusChanged;

  List<ActiveTokenSummary> _tokens = [];
  bool isRestoring = false;

  /// Newest-remembered-last is not guaranteed or meaningful here; callers
  /// that care about order (Home's "most recent first") sort explicitly.
  List<ActiveTokenSummary> get activeTokens => List.unmodifiable(_tokens);
  bool get hasActiveToken => _tokens.isNotEmpty;

  /// True only when exactly one token is remembered — Home and the drawer
  /// use this to decide between the single convenient button and the list.
  ActiveTokenSummary? get soleActiveToken => _tokens.length == 1 ? _tokens.first : null;

  ActiveTokenSummary? summaryFor(String tokenId) =>
      _tokens.where((t) => t.tokenId == tokenId).firstOrNull;

  /// Reads the pointers left by a previous run. Called once at startup; does
  /// not hit the network, so a cold start is not delayed by it — the
  /// authoritative check happens when the customer actually opens a token
  /// (or via the background resync SplashScreen kicks off after Home shows).
  Future<void> restore() async {
    isRestoring = true;
    notifyListeners();
    _tokens = await _storage.readAll();
    isRestoring = false;
    notifyListeners();
  }

  /// Records a freshly created token as one of this installation's active
  /// ones. Upserts by token id (idempotent): a retried join that produces
  /// the exact same token never duplicates the entry, and — critically —
  /// remembering a token in Queue B never touches Queue A's entry, because
  /// they carry different ids. This is what makes joining a second queue
  /// additive rather than a replacement.
  Future<void> remember(LiveQueueToken token, {required String queueName}) async {
    final summary = ActiveTokenSummary.fromToken(token, queueName: queueName);
    _tokens = [..._tokens.where((t) => t.tokenId != token.id), summary];
    await _storage.upsert(summary);
    notifyListeners();
  }

  /// Re-reads one remembered token from the backend and returns it if it is
  /// still active — the authoritative check, and the only one that matters:
  /// a stale local status must never decide whether a customer can reopen
  /// their token.
  ///
  /// A network failure deliberately leaves the entry alone and returns null:
  /// not being able to reach the server says nothing about whether the
  /// customer is still in the queue, and forgetting their token over a
  /// dropped connection would be the worst possible reading of it.
  Future<LiveQueueToken?> resyncOne(String tokenId) async {
    final existing = summaryFor(tokenId);
    if (existing == null) return null;

    try {
      final token = await _tokenRepository.getToken(tokenId);
      final statusChanged = existing.status != token.status;
      final active = isActiveTokenStatus(token.status);

      if (!active) {
        await remove(tokenId);
      } else {
        final updated = existing.copyWith(
          serialNumber: token.serialNumber,
          queueName: existing.queueName,
          status: token.status,
          lastKnownUpdatedAt: DateTime.now(),
        );
        _tokens = [..._tokens.where((t) => t.tokenId != tokenId), updated];
        await _storage.upsert(updated);
        notifyListeners();
      }

      if (statusChanged) {
        onTokenStatusChanged?.call(token, queueName: existing.queueName);
      }
      // null exactly when the entry was just removed — SKIPPED is now
      // terminal for this collection (Recall was removed), same as
      // COMPLETED/CANCELLED: "no longer a token this screen has anything to
      // show".
      return active ? token : null;
    } on ApiException catch (e) {
      // 404 is the one answer that genuinely means "this token is gone".
      if (e.statusCode == 404) {
        await remove(tokenId);
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /// Resyncs every remembered token. Deliberately not sequential: the list
  /// is always small (a customer holds at most a handful of active tokens
  /// across different queues at once), so resyncing concurrently rather than
  /// one request after another is both simpler and faster, with no separate
  /// bounded-concurrency machinery needed. One token's failure — network
  /// error, 404, an unexpected exception — is fully isolated from every
  /// other: [resyncOne] already never throws, so a `Future.wait` here can
  /// never abort partway and leave the rest unresynced.
  Future<void> resyncAll() async {
    if (_tokens.isEmpty) return;
    final ids = _tokens.map((t) => t.tokenId).toList(growable: false);
    await Future.wait(ids.map(resyncOne));
  }

  /// Removes exactly one token by id. Never wipes the whole collection —
  /// there is deliberately no global "clear active tokens" left in this
  /// class; every removal here is scoped to the one token that actually
  /// reached a terminal state.
  Future<void> remove(String tokenId) async {
    if (_tokens.none((t) => t.tokenId == tokenId)) return;
    _tokens = _tokens.where((t) => t.tokenId != tokenId).toList();
    await _storage.remove(tokenId);
    notifyListeners();
  }

  /// Called when a token reaches a terminal state, or the customer cancels.
  /// Updates or removes only the token identified by [token.id] — SKIPPED is
  /// now terminal for this collection (Recall was removed), so it is
  /// removed exactly like COMPLETED/CANCELLED. History is untouched either
  /// way — it is stored separately by [HistoryRepository] and keeps the
  /// record regardless of what happens here.
  Future<void> syncFromTracked(LiveQueueToken token) async {
    final existing = summaryFor(token.id);
    if (existing == null) return;

    if (!isActiveTokenStatus(token.status)) {
      await remove(token.id);
      return;
    }

    final updated = existing.copyWith(status: token.status, lastKnownUpdatedAt: DateTime.now());
    _tokens = [..._tokens.where((t) => t.tokenId != token.id), updated];
    await _storage.upsert(updated);
    notifyListeners();
  }
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}

extension _None<T> on Iterable<T> {
  bool none(bool Function(T) test) => !any(test);
}
