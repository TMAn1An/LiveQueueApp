import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as socket_io;

import '../utils/app_config.dart';

/// Thin wrapper over socket_io_client implementing the Phase 4 real-time
/// contract exactly as built server-side (backend/src/realtime/):
///   - connects anonymously (no JWT — the mobile app is always a customer,
///     never staff; ADR-007/approved Phase 4 decision 3)
///   - joins queue:{id} and token:{id} rooms via the `join:queue` /
///     `join:token` acknowledged events (approved decision 2)
///   - never joins organization:{id} — that's staff-only and would be
///     rejected anyway
///   - re-joins rooms itself after a reconnect; the server does not persist
///     room membership across a disconnect (approved decision 7 — "no
///     event replay... reconnection is a fresh handshake + fresh room
///     joins"), so this class remembers which rooms it had joined and
///     replays those joins client-side, exactly as the spec expects
class SocketService {
  socket_io.Socket? _socket;
  String? _joinedQueueId;
  String? _joinedTokenId;

  final _connectionController = StreamController<bool>.broadcast();
  final _tokenCalledController = StreamController<Map<String, dynamic>>.broadcast();
  final _tokenStartedController = StreamController<Map<String, dynamic>>.broadcast();
  final _tokenCompletedController = StreamController<Map<String, dynamic>>.broadcast();
  final _tokenSkippedController = StreamController<Map<String, dynamic>>.broadcast();
  final _tokenPositionChangedController = StreamController<Map<String, dynamic>>.broadcast();
  final _queueStatusChangedController = StreamController<Map<String, dynamic>>.broadcast();

  Stream<bool> get connectionStatus => _connectionController.stream;
  Stream<Map<String, dynamic>> get tokenCalled => _tokenCalledController.stream;
  Stream<Map<String, dynamic>> get tokenStarted => _tokenStartedController.stream;
  Stream<Map<String, dynamic>> get tokenCompleted => _tokenCompletedController.stream;
  Stream<Map<String, dynamic>> get tokenSkipped => _tokenSkippedController.stream;
  Stream<Map<String, dynamic>> get tokenPositionChanged => _tokenPositionChangedController.stream;
  Stream<Map<String, dynamic>> get queueStatusChanged => _queueStatusChangedController.stream;

  bool get isConnected => _socket?.connected ?? false;

  void connect() {
    if (_socket != null) return;

    final socket = socket_io.io(
      AppConfig.apiBaseUrl,
      socket_io.OptionBuilder()
          .setTransports(['websocket'])
          .disableAutoConnect()
          .build(),
    );

    socket
      ..onConnect((_) {
        _connectionController.add(true);
        // Re-join whatever rooms this client cared about before — the
        // server keeps no memory of prior room membership across a
        // disconnect, by design (approved Phase 4 decision 7).
        final queueId = _joinedQueueId;
        final tokenId = _joinedTokenId;
        if (queueId != null) _emitJoinQueue(socket, queueId);
        if (tokenId != null) _emitJoinToken(socket, tokenId);
      })
      ..onDisconnect((_) => _connectionController.add(false))
      ..onConnectError((_) => _connectionController.add(false))
      ..on('token.called', (data) => _forward(_tokenCalledController, data))
      ..on('token.started', (data) => _forward(_tokenStartedController, data))
      ..on('token.completed', (data) => _forward(_tokenCompletedController, data))
      ..on('token.skipped', (data) => _forward(_tokenSkippedController, data))
      ..on('token.position_changed', (data) => _forward(_tokenPositionChangedController, data))
      ..on('queue.status_changed', (data) => _forward(_queueStatusChangedController, data));

    _socket = socket;
    socket.connect();
  }

  void _forward(StreamController<Map<String, dynamic>> controller, dynamic data) {
    if (data is Map) {
      controller.add(Map<String, dynamic>.from(data));
    }
  }

  Future<void> joinQueueRoom(String queueId) async {
    _joinedQueueId = queueId;
    final socket = _socket;
    if (socket != null && socket.connected) {
      _emitJoinQueue(socket, queueId);
    }
  }

  Future<void> joinTokenRoom(String tokenId) async {
    _joinedTokenId = tokenId;
    final socket = _socket;
    if (socket != null && socket.connected) {
      _emitJoinToken(socket, tokenId);
    }
  }

  void _emitJoinQueue(socket_io.Socket socket, String queueId) {
    socket.emitWithAck('join:queue', {'queueId': queueId}, ack: (_) {});
  }

  void _emitJoinToken(socket_io.Socket socket, String tokenId) {
    socket.emitWithAck('join:token', {'tokenId': tokenId}, ack: (_) {});
  }

  void leaveTokenTracking() {
    _joinedTokenId = null;
  }

  void disconnect() {
    _socket?.disconnect();
    _socket?.dispose();
    _socket = null;
    _joinedQueueId = null;
    _joinedTokenId = null;
  }

  void dispose() {
    disconnect();
    _connectionController.close();
    _tokenCalledController.close();
    _tokenStartedController.close();
    _tokenCompletedController.close();
    _tokenSkippedController.close();
    _tokenPositionChangedController.close();
    _queueStatusChangedController.close();
  }
}
