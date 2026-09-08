import 'package:flutter/foundation.dart';

import '../models/live_queue_token.dart';
import '../repositories/token_repository.dart';
import '../services/active_token_storage_service.dart';
import '../services/api_exception.dart';

/// Whether this installation currently has somebody standing in a queue, and
/// how to get back to them (ADR-036).
///
/// Deliberately separate from [TokenTrackingProvider], which owns the live
/// socket session and only exists while the tracking screen is open. This one
/// outlives every screen: it is what lets Home, the menu and a cold start
/// know there is a token to return to.
///
/// It never decides a token's fate. The backend is authoritative; this
/// resyncs and then either keeps the pointer (still active) or drops it
/// (terminal). Navigation never touches it.
class ActiveTokenProvider extends ChangeNotifier {
  ActiveTokenProvider({
    required TokenRepository tokenRepository,
    required ActiveTokenStorageService storage,
  })  : _tokenRepository = tokenRepository,
        _storage = storage;

  final TokenRepository _tokenRepository;
  final ActiveTokenStorageService _storage;

  ActiveTokenRef? _ref;
  bool isRestoring = false;

  /// The remembered token, if any. Present from the moment a token is
  /// created until it reaches a terminal state — across screens, Back
  /// presses, and app restarts.
  ActiveTokenRef? get activeToken => _ref;
  bool get hasActiveToken => _ref != null;

  /// Reads the pointer left by a previous run. Called once at startup; does
  /// not hit the network, so a cold start is not delayed by it — the
  /// authoritative check happens when the customer actually opens the token.
  Future<void> restore() async {
    isRestoring = true;
    notifyListeners();
    _ref = await _storage.read();
    isRestoring = false;
    notifyListeners();
  }

  /// Records a freshly created token as this installation's active one.
  Future<void> remember(LiveQueueToken token, {required String queueName}) async {
    _ref = ActiveTokenRef(
      tokenId: token.id,
      serialNumber: token.serialNumber,
      queueName: queueName,
    );
    await _storage.save(_ref!);
    notifyListeners();
  }

  /// Re-reads the token from the backend and returns it if it is still live.
  ///
  /// This is the authoritative check, and the only one that matters: a stale
  /// local status must never decide whether a customer can reopen their
  /// token. A token that has since been completed, skipped or cancelled
  /// stops being the active one here — it stays in history, which is a
  /// separate record entirely.
  ///
  /// A network failure deliberately leaves the pointer alone and returns
  /// null: not being able to reach the server says nothing about whether the
  /// customer is still in the queue, and forgetting their token over a
  /// dropped connection would be the worst possible reading of it.
  Future<LiveQueueToken?> resync() async {
    final ref = _ref;
    if (ref == null) return null;

    try {
      final token = await _tokenRepository.getToken(ref.tokenId);
      if (!token.isActive) {
        await clear();
        return null;
      }
      // Keep the label honest if the serial ever differs from what was saved.
      if (token.serialNumber != ref.serialNumber) {
        _ref = ActiveTokenRef(
          tokenId: ref.tokenId,
          serialNumber: token.serialNumber,
          queueName: ref.queueName,
        );
        await _storage.save(_ref!);
        notifyListeners();
      }
      return token;
    } on ApiException catch (e) {
      // 404 is the one answer that genuinely means "this token is gone".
      if (e.statusCode == 404) {
        await clear();
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /// Called when a token reaches a terminal state, or the customer cancels.
  /// History is untouched — it is stored separately and keeps the record.
  Future<void> clear() async {
    _ref = null;
    await _storage.clear();
    notifyListeners();
  }

  /// Drops the pointer if the given token is the remembered one and has
  /// become terminal. Lets the tracking session report a status change
  /// without needing to know whether this is the active token.
  Future<void> syncFromTracked(LiveQueueToken token) async {
    if (_ref?.tokenId != token.id) return;
    if (!token.isActive) {
      await clear();
    }
  }
}
