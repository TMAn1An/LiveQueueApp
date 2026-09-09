import 'live_queue_token.dart';

/// A lightweight, locally-persisted pointer to one token this installation
/// is (or may still be) queued with — one customer, potentially several of
/// these at once across different queues (V2 Product Completion checkpoint).
///
/// Deliberately thin: only what the app needs before it can reach the
/// backend again (a label for the UI) plus [status], which exists purely so
/// Home/the Active Tokens screen can render something plausible before the
/// first resync lands. The backend is always re-consulted before anything
/// is trusted — this is a pointer, never a cache of truth.
///
/// [tokenId] is the sole identity. Two summaries are the same entry if and
/// only if their [tokenId] matches; nothing here is ever keyed by queue,
/// serial number or position, since none of those are unique across the
/// collection this now supports.
class ActiveTokenSummary {
  const ActiveTokenSummary({
    required this.tokenId,
    required this.serialNumber,
    required this.queueId,
    required this.queueName,
    required this.status,
    required this.lastKnownUpdatedAt,
  });

  final String tokenId;
  final String serialNumber;
  final String queueId;
  final String queueName;
  final TokenStatus status;

  /// When this summary was last confirmed against the backend (or first
  /// created, before any resync). Not shown prominently in the UI today;
  /// kept so a future "last checked" affordance costs no storage migration.
  final DateTime lastKnownUpdatedAt;

  factory ActiveTokenSummary.fromToken(LiveQueueToken token, {required String queueName}) {
    return ActiveTokenSummary(
      tokenId: token.id,
      serialNumber: token.serialNumber,
      queueId: token.queueId,
      queueName: queueName,
      status: token.status,
      lastKnownUpdatedAt: DateTime.now(),
    );
  }

  ActiveTokenSummary copyWith({
    String? serialNumber,
    String? queueName,
    TokenStatus? status,
    DateTime? lastKnownUpdatedAt,
  }) {
    return ActiveTokenSummary(
      tokenId: tokenId,
      serialNumber: serialNumber ?? this.serialNumber,
      queueId: queueId,
      queueName: queueName ?? this.queueName,
      status: status ?? this.status,
      lastKnownUpdatedAt: lastKnownUpdatedAt ?? this.lastKnownUpdatedAt,
    );
  }

  Map<String, dynamic> toJson() => {
        'tokenId': tokenId,
        'serialNumber': serialNumber,
        'queueId': queueId,
        'queueName': queueName,
        'status': status.name,
        'lastKnownUpdatedAt': lastKnownUpdatedAt.toIso8601String(),
      };

  /// Never throws: one corrupt entry in a stored list is skipped by the
  /// caller, not allowed to take down every other remembered token.
  static ActiveTokenSummary fromJson(Map<String, dynamic> json) {
    return ActiveTokenSummary(
      tokenId: json['tokenId'] as String,
      serialNumber: json['serialNumber'] as String? ?? '',
      queueId: json['queueId'] as String? ?? '',
      queueName: json['queueName'] as String? ?? '',
      status: _statusByName(json['status'] as String?),
      lastKnownUpdatedAt: DateTime.tryParse(json['lastKnownUpdatedAt'] as String? ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0),
    );
  }

  static TokenStatus _statusByName(String? name) {
    for (final value in TokenStatus.values) {
      if (value.name == name) return value;
    }
    return TokenStatus.unknown;
  }
}
