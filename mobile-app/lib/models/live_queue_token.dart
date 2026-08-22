import 'counter_info.dart';

/// Mirrors the backend's TokenStatus enum exactly (backend/prisma/schema.prisma).
enum TokenStatus { waiting, called, inProgress, completed, skipped, unknown }

TokenStatus parseTokenStatus(String raw) {
  switch (raw) {
    case 'WAITING':
      return TokenStatus.waiting;
    case 'CALLED':
      return TokenStatus.called;
    case 'IN_PROGRESS':
      return TokenStatus.inProgress;
    case 'COMPLETED':
      return TokenStatus.completed;
    case 'SKIPPED':
      return TokenStatus.skipped;
    default:
      return TokenStatus.unknown;
  }
}

/// The customer-safe token view (Phase 3 `toCustomerView` /
/// Phase 4 token:{id} room payload) — everything the mobile app is ever
/// allowed to see about a token. Never includes organizationId, deviceId,
/// idempotencyKey, or formVersion (approved Phase 3 decision 8).
class LiveQueueToken {
  const LiveQueueToken({
    required this.id,
    required this.queueId,
    required this.serviceId,
    required this.serialNumber,
    required this.status,
    required this.formData,
    required this.position,
    required this.estimatedWaitMinutes,
    required this.counter,
    required this.createdAt,
    this.calledAt,
    this.startedAt,
    this.completedAt,
    this.skippedAt,
  });

  final String id;
  final String queueId;
  final String serviceId;
  final String serialNumber;
  final TokenStatus status;
  final Map<String, dynamic> formData;
  final int? position;
  final int? estimatedWaitMinutes;
  final CounterInfo? counter;
  final DateTime createdAt;
  final DateTime? calledAt;
  final DateTime? startedAt;
  final DateTime? completedAt;
  final DateTime? skippedAt;

  bool get isActive => status == TokenStatus.waiting || status == TokenStatus.called || status == TokenStatus.inProgress;

  factory LiveQueueToken.fromJson(Map<String, dynamic> json) {
    return LiveQueueToken(
      id: json['id'] as String,
      queueId: json['queueId'] as String,
      serviceId: json['serviceId'] as String,
      serialNumber: json['serialNumber'] as String,
      status: parseTokenStatus(json['status'] as String),
      formData: (json['formData'] as Map<String, dynamic>?) ?? const {},
      position: json['position'] as int?,
      estimatedWaitMinutes: json['estimatedWaitMinutes'] as int?,
      counter: json['counter'] == null
          ? null
          : CounterInfo.fromJson(json['counter'] as Map<String, dynamic>),
      createdAt: DateTime.parse(json['createdAt'] as String),
      calledAt: json['calledAt'] == null ? null : DateTime.parse(json['calledAt'] as String),
      startedAt: json['startedAt'] == null ? null : DateTime.parse(json['startedAt'] as String),
      completedAt: json['completedAt'] == null ? null : DateTime.parse(json['completedAt'] as String),
      skippedAt: json['skippedAt'] == null ? null : DateTime.parse(json['skippedAt'] as String),
    );
  }

  LiveQueueToken copyWith({
    TokenStatus? status,
    int? position,
    bool clearPosition = false,
    int? estimatedWaitMinutes,
    bool clearEstimatedWaitMinutes = false,
    CounterInfo? counter,
  }) {
    return LiveQueueToken(
      id: id,
      queueId: queueId,
      serviceId: serviceId,
      serialNumber: serialNumber,
      status: status ?? this.status,
      formData: formData,
      position: clearPosition ? null : (position ?? this.position),
      estimatedWaitMinutes:
          clearEstimatedWaitMinutes ? null : (estimatedWaitMinutes ?? this.estimatedWaitMinutes),
      counter: counter ?? this.counter,
      createdAt: createdAt,
      calledAt: calledAt,
      startedAt: startedAt,
      completedAt: completedAt,
      skippedAt: skippedAt,
    );
  }
}

/// The lightweight GET /api/tokens/:id/status shape — used for cheap polling
/// / reconnect resync (spec section 26: "refresh token status after
/// reconnecting").
class TokenStatusSnapshot {
  const TokenStatusSnapshot({
    required this.id,
    required this.status,
    required this.position,
    required this.estimatedWaitMinutes,
  });

  final String id;
  final TokenStatus status;
  final int? position;
  final int? estimatedWaitMinutes;

  factory TokenStatusSnapshot.fromJson(Map<String, dynamic> json) {
    return TokenStatusSnapshot(
      id: json['id'] as String,
      status: parseTokenStatus(json['status'] as String),
      position: json['position'] as int?,
      estimatedWaitMinutes: json['estimatedWaitMinutes'] as int?,
    );
  }
}
