import 'counter_info.dart';
import 'queue_schedule_status.dart';

/// Mirrors the backend's TokenStatus enum exactly (backend/prisma/schema.prisma).
enum TokenStatus { waiting, called, inProgress, completed, skipped, cancelled, unknown }

/// Shared by LiveQueueToken.isActive and TokenHistoryScreen (which only has
/// a bare TokenStatus, not a full LiveQueueToken, to check) — kept in one
/// place so "what counts as still-active" is never defined twice.
bool isActiveTokenStatus(TokenStatus status) =>
    status == TokenStatus.waiting || status == TokenStatus.called || status == TokenStatus.inProgress;

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
    case 'CANCELLED':
      return TokenStatus.cancelled;
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
    this.queueTimezone,
    required this.serviceId,
    required this.serialNumber,
    required this.status,
    required this.formData,
    required this.position,
    required this.estimatedWaitMinutes,
    required this.estimatedReadyAt,
    this.etaUnavailableReason,
    required this.counter,
    required this.createdAt,
    this.calledAt,
    this.startedAt,
    this.completedAt,
    this.skippedAt,
    this.cancelledAt,
    this.serviceStartVerificationRequired = true,
    this.skipReasonCode,
    this.skipReasonText,
    this.completionFeedback,
    this.assignedSession,
    this.reminderSent = false,
  });

  /// ADR-062: whether the backend has already pushed this token's "almost
  /// your turn" reminder. The app's own reminder — the one it raises while
  /// Live Tracking is open — stays quiet once this is true, so the customer
  /// is told once, not once per channel. False from a backend that predates
  /// the field.
  final bool reminderSent;

  /// Phase 4 — the fixed session window this token was assigned to at
  /// creation, when its queue schedules sessions. Never changes afterward,
  /// even if the session is later edited (the backend snapshots it) — so
  /// this is safe to show once and forget, not something Live Tracking
  /// needs to keep resyncing. Null for every token on an unscheduled queue.
  final QueueSessionWindow? assignedSession;

  final String id;

  /// ADR-042 — why staff skipped this token, when they did. The code is for
  /// the app's own use; [skipReasonText] is the exact wording the customer
  /// should read, as the backend recorded it at skip time. Both null for a
  /// token that was not skipped, and for a skip from before reasons existed.
  final String? skipReasonCode;
  final String? skipReasonText;

  /// ADR-042 — staff's optional note on completion. Null for an ordinary
  /// completion, in which case nothing about feedback is shown at all.
  final String? completionFeedback;

  /// What to show the customer as the skip reason, or null when there is
  /// none to show. Prefers the recorded wording; falls back to a local label
  /// only if a reason arrived without text.
  String? get skipReasonDisplay {
    final text = skipReasonText?.trim();
    if (text != null && text.isNotEmpty) return text;
    return skipReasonLabel(skipReasonCode);
  }
  final String queueId;

  /// ADR-041 — whether this token's queue asks for the service-start
  /// verification code. Always the backend's answer, never guessed locally:
  /// when false there is no code to show, and the app says nothing about
  /// one. Defaults to true when absent, so a response from a backend that
  /// predates the setting keeps the verified flow's UI.
  final bool serviceStartVerificationRequired;

  /// ADR-035 — the queue's own IANA zone, so live tracking can show the
  /// queue's clock beside the customer's. Null when the organization has
  /// not set one.
  final String? queueTimezone;
  final String serviceId;
  final String serialNumber;
  final TokenStatus status;
  final Map<String, dynamic> formData;
  final int? position;
  final int? estimatedWaitMinutes;
  /// V2 Checkpoint 4 (ADR-026): server-authoritative anchor for the live
  /// countdown — the UI ticks a local Timer against this timestamp and
  /// re-anchors whenever a fresh one arrives; it never computes its own
  /// estimate. Null exactly when estimatedWaitMinutes is (no active
  /// counters, or not a WAITING token).
  final DateTime? estimatedReadyAt;

  /// Why the backend could not estimate a wait, when it knows. Today the
  /// only value is `no_active_counter` — nobody is serving this queue, so
  /// any number would be invented. Null means either an estimate exists or
  /// the reason is unknown; both are handled by the generic fallback text.
  final String? etaUnavailableReason;

  /// Whether the missing estimate is explained by the queue simply having
  /// nobody serving right now, which is worth telling the customer plainly
  /// rather than leaving them at "unavailable".
  bool get isWaitingForActiveCounter =>
      etaUnavailableReason == LiveQueueToken.reasonNoActiveCounter;

  /// ADR-048: this token was given a place in a later session today, which
  /// has not started yet. Until it does the backend gives no position and no
  /// ETA — any number would suggest being served before the session starts —
  /// so the app shows "Scheduled for 14:00–17:00" instead.
  bool get isAwaitingSessionStart =>
      etaUnavailableReason == LiveQueueToken.reasonSessionNotStarted;

  static const String reasonNoActiveCounter = 'NO_ACTIVE_COUNTER';
  static const String reasonSessionNotStarted = 'SESSION_NOT_STARTED';

  final CounterInfo? counter;
  final DateTime createdAt;
  final DateTime? calledAt;
  final DateTime? startedAt;
  final DateTime? completedAt;
  final DateTime? skippedAt;
  /// V2 Checkpoint 7 (ADR-029) — set only on a customer-initiated CANCELLED
  /// transition, distinct from skippedAt.
  final DateTime? cancelledAt;

  bool get isActive => isActiveTokenStatus(status);

  factory LiveQueueToken.fromJson(Map<String, dynamic> json) {
    return LiveQueueToken(
      id: json['id'] as String,
      queueId: json['queueId'] as String,
      queueTimezone: json['queueTimezone'] as String?,
      serviceId: json['serviceId'] as String,
      serialNumber: json['serialNumber'] as String,
      status: parseTokenStatus(json['status'] as String),
      formData: (json['formData'] as Map<String, dynamic>?) ?? const {},
      position: json['position'] as int?,
      estimatedWaitMinutes: json['estimatedWaitMinutes'] as int?,
      estimatedReadyAt: json['estimatedReadyAt'] == null
          ? null
          : DateTime.parse(json['estimatedReadyAt'] as String),
      etaUnavailableReason: json['etaUnavailableReason'] as String?,
      counter: json['counter'] == null
          ? null
          : CounterInfo.fromJson(json['counter'] as Map<String, dynamic>),
      createdAt: DateTime.parse(json['createdAt'] as String),
      calledAt: json['calledAt'] == null ? null : DateTime.parse(json['calledAt'] as String),
      startedAt: json['startedAt'] == null ? null : DateTime.parse(json['startedAt'] as String),
      completedAt: json['completedAt'] == null ? null : DateTime.parse(json['completedAt'] as String),
      skippedAt: json['skippedAt'] == null ? null : DateTime.parse(json['skippedAt'] as String),
      cancelledAt: json['cancelledAt'] == null ? null : DateTime.parse(json['cancelledAt'] as String),
      serviceStartVerificationRequired: json['serviceStartVerificationRequired'] as bool? ?? true,
      skipReasonCode: (json['skipReason'] as Map<String, dynamic>?)?['code'] as String?,
      skipReasonText: (json['skipReason'] as Map<String, dynamic>?)?['text'] as String?,
      completionFeedback: _nonBlank(json['completionFeedback'] as String?),
      assignedSession: json['assignedSession'] == null
          ? null
          : QueueSessionWindow.fromJson(json['assignedSession'] as Map<String, dynamic>),
      reminderSent: json['reminderSent'] as bool? ?? false,
    );
  }

  static String? _nonBlank(String? value) =>
      value == null || value.trim().isEmpty ? null : value;

  LiveQueueToken copyWith({
    TokenStatus? status,
    int? position,
    bool clearPosition = false,
    int? estimatedWaitMinutes,
    bool clearEstimatedWaitMinutes = false,
    DateTime? estimatedReadyAt,
    bool clearEstimatedReadyAt = false,
    /// Always replaced outright rather than merged: a live update carries
    /// the current reason or none at all, and keeping a stale one would tell
    /// the customer a counter is still missing after one has opened.
    String? etaUnavailableReason,
    CounterInfo? counter,
  }) {
    return LiveQueueToken(
      id: id,
      queueId: queueId,
      queueTimezone: queueTimezone,
      serviceId: serviceId,
      serialNumber: serialNumber,
      status: status ?? this.status,
      formData: formData,
      position: clearPosition ? null : (position ?? this.position),
      estimatedWaitMinutes:
          clearEstimatedWaitMinutes ? null : (estimatedWaitMinutes ?? this.estimatedWaitMinutes),
      estimatedReadyAt:
          clearEstimatedReadyAt ? null : (estimatedReadyAt ?? this.estimatedReadyAt),
      etaUnavailableReason: etaUnavailableReason,
      counter: counter ?? this.counter,
      createdAt: createdAt,
      calledAt: calledAt,
      startedAt: startedAt,
      completedAt: completedAt,
      skippedAt: skippedAt,
      cancelledAt: cancelledAt,
      serviceStartVerificationRequired: serviceStartVerificationRequired,
      skipReasonCode: skipReasonCode,
      skipReasonText: skipReasonText,
      completionFeedback: completionFeedback,
      assignedSession: assignedSession,
      reminderSent: reminderSent,
    );
  }
}

/// ADR-042 — the wording the skipped person reads for each skip reason code, used
/// only as a fallback when a reason arrives without its recorded text (the
/// backend always records one). Mirrors the backend's labels.
String? skipReasonLabel(String? code) {
  return switch (code) {
    'CUSTOMER_NOT_PRESENT' => 'Person not present',
    'NO_RESPONSE' => 'No response from person',
    'MISSING_REQUIREMENT' => 'Required document/information missing',
    'CUSTOMER_LEFT' => 'Person requested to leave',
    _ => null,
  };
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
    required this.estimatedReadyAt,
  });

  final String id;
  final TokenStatus status;
  final int? position;
  final int? estimatedWaitMinutes;
  final DateTime? estimatedReadyAt;

  factory TokenStatusSnapshot.fromJson(Map<String, dynamic> json) {
    return TokenStatusSnapshot(
      id: json['id'] as String,
      status: parseTokenStatus(json['status'] as String),
      position: json['position'] as int?,
      estimatedWaitMinutes: json['estimatedWaitMinutes'] as int?,
      estimatedReadyAt: json['estimatedReadyAt'] == null
          ? null
          : DateTime.parse(json['estimatedReadyAt'] as String),
    );
  }
}

/// The user-facing name of a status, for the neutral places that just
/// report state (token history, token details). Defined once so a status
/// added to the enum can never quietly render as "Unknown" in one screen
/// and correctly in another — the switch is exhaustive, so a new value
/// fails to compile until it is given a label here.
///
/// Live Tracking deliberately keeps its own wording via [StatusBadge]
/// ("Your Turn" rather than "Called") — that is a different, in-the-moment
/// voice, not a duplicate of this mapping.
String tokenStatusLabel(TokenStatus status) {
  return switch (status) {
    TokenStatus.waiting => 'Waiting',
    TokenStatus.called => 'Called',
    TokenStatus.inProgress => 'In Progress',
    TokenStatus.completed => 'Completed',
    TokenStatus.skipped => 'Skipped',
    TokenStatus.cancelled => 'Cancelled',
    TokenStatus.unknown => 'Unknown',
  };
}
