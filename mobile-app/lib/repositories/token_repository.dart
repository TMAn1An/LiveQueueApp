import '../models/live_queue_token.dart';
import '../services/socket_service.dart';
import '../services/token_api_service.dart';

/// A position/wait update delivered by token.position_changed — a partial
/// update, unlike the other lifecycle events (see class doc below).
class PositionUpdate {
  const PositionUpdate({
    required this.position,
    required this.estimatedWaitMinutes,
    required this.estimatedReadyAt,
  });
  final int position;
  final int? estimatedWaitMinutes;
  /// V2 Checkpoint 4 (ADR-026) — see LiveQueueToken.estimatedReadyAt.
  final DateTime? estimatedReadyAt;
}

/// True when the queue this token belongs to was just paused, false when
/// resumed (derived from queue.status_changed's public-safe `{id, status}`
/// payload — Phase 4 approved decision 2).
class QueueStatusUpdate {
  const QueueStatusUpdate({required this.queueId, required this.isPaused});
  final String queueId;
  final bool isPaused;
}

/// Combines REST (initial fetch + reconnect resync) and Socket.io (live
/// updates) into one source of truth for a tracked token. Mirrors the
/// backend's own rule (ADR-002 / Phase 4 ADR-017): the socket is a
/// notification layer, REST/the server is the source of truth — so this
/// repository always resyncs via REST after a reconnect rather than trusting
/// that no events were missed while disconnected (spec section 26).
class TokenRepository {
  TokenRepository({
    required TokenApiService apiService,
    required SocketService socketService,
  })  : _apiService = apiService,
        _socketService = socketService;

  final TokenApiService _apiService;
  final SocketService _socketService;

  Future<LiveQueueToken> createToken({
    required String queueId,
    required List<String> serviceIds,
    required String deviceIdentifier,
    required Map<String, dynamic> formData,
    required String idempotencyKey,
  }) {
    return _apiService.createToken(
      queueId: queueId,
      serviceIds: serviceIds,
      deviceIdentifier: deviceIdentifier,
      formData: formData,
      idempotencyKey: idempotencyKey,
    );
  }

  Future<LiveQueueToken> getToken(String tokenId) => _apiService.getToken(tokenId);

  Stream<bool> get connectionStatus => _socketService.connectionStatus;

  /// token.called / token.started / token.completed / token.skipped all
  /// carry the *full* customer-safe token view as their payload (Phase 4
  /// ADR-017: "the existing Phase 3 customer-safe view"), so each can be
  /// parsed directly into a complete LiveQueueToken — no partial-merge
  /// logic needed for these four.
  Stream<LiveQueueToken> get tokenLifecycleUpdates {
    return _mergeEnvelopeStreams([
      _socketService.tokenCalled,
      _socketService.tokenStarted,
      _socketService.tokenCompleted,
      _socketService.tokenSkipped,
    ]).map((envelope) => LiveQueueToken.fromJson(envelope['data'] as Map<String, dynamic>));
  }

  Stream<PositionUpdate> get positionUpdates {
    return _socketService.tokenPositionChanged.map((envelope) {
      final data = envelope['data'] as Map<String, dynamic>;
      return PositionUpdate(
        position: data['position'] as int,
        estimatedWaitMinutes: data['estimatedWaitMinutes'] as int?,
        estimatedReadyAt: data['estimatedReadyAt'] == null
            ? null
            : DateTime.parse(data['estimatedReadyAt'] as String),
      );
    });
  }

  Stream<QueueStatusUpdate> get queueStatusUpdates {
    return _socketService.queueStatusChanged.map((envelope) {
      final data = envelope['data'] as Map<String, dynamic>;
      return QueueStatusUpdate(
        queueId: data['id'] as String,
        isPaused: data['status'] == 'PAUSED',
      );
    });
  }

  void connectSocket() => _socketService.connect();

  Future<void> joinTokenRoom(String tokenId) => _socketService.joinTokenRoom(tokenId);

  Future<void> joinQueueRoom(String queueId) => _socketService.joinQueueRoom(queueId);

  void stopTracking() => _socketService.leaveTokenTracking();

  Stream<Map<String, dynamic>> _mergeEnvelopeStreams(
    List<Stream<Map<String, dynamic>>> streams,
  ) {
    return Stream<Map<String, dynamic>>.multi((controller) {
      final subscriptions = streams
          .map((s) => s.listen(controller.add, onError: controller.addError))
          .toList();
      controller.onCancel = () {
        for (final sub in subscriptions) {
          sub.cancel();
        }
      };
    });
  }
}
