import 'live_queue_token.dart';

/// A locally-persisted record of a past token (spec section 7.20: "The
/// mobile app should show previous tokens associated with the device...
/// Keep the most recent 100 history records locally"). Denormalized at
/// creation time from the queue config + selected service already in hand
/// client-side — the backend's customer-safe token view has no queue/service
/// *name* fields to look up later (see PROGRESS.md known limitations).
class HistoryEntry {
  const HistoryEntry({
    required this.tokenId,
    required this.queueId,
    required this.queueName,
    required this.serviceId,
    required this.serviceName,
    this.additionalServiceNames = const [],
    required this.serialNumber,
    required this.createdAt,
    required this.finalStatus,
    this.skipReason,
    this.completionFeedback,
  });

  /// ADR-042 — why staff skipped this visit, exactly as the customer was
  /// told. Null when it was not skipped, and on every entry stored before
  /// skip reasons existed.
  final String? skipReason;

  /// ADR-042 — staff's optional note when completing this visit.
  final String? completionFeedback;

  final String tokenId;
  final String queueId;
  final String queueName;
  /// The first selected service (V2 Checkpoint 5) — kept as its own field,
  /// not folded into a list, so every already-stored on-device history
  /// entry from before this checkpoint keeps round-tripping unchanged.
  final String serviceId;
  final String serviceName;
  /// Names of any services beyond the first, if the customer selected more
  /// than one (V2 Checkpoint 5). Empty for a single-service join, and for
  /// every entry recorded before this checkpoint.
  final List<String> additionalServiceNames;
  final String serialNumber;
  final DateTime createdAt;
  final TokenStatus finalStatus;

  HistoryEntry copyWith({
    TokenStatus? finalStatus,
    String? skipReason,
    String? completionFeedback,
  }) {
    return HistoryEntry(
      tokenId: tokenId,
      queueId: queueId,
      queueName: queueName,
      serviceId: serviceId,
      serviceName: serviceName,
      additionalServiceNames: additionalServiceNames,
      serialNumber: serialNumber,
      createdAt: createdAt,
      finalStatus: finalStatus ?? this.finalStatus,
      skipReason: skipReason ?? this.skipReason,
      completionFeedback: completionFeedback ?? this.completionFeedback,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'tokenId': tokenId,
      'queueId': queueId,
      'queueName': queueName,
      'serviceId': serviceId,
      'serviceName': serviceName,
      'additionalServiceNames': additionalServiceNames,
      'serialNumber': serialNumber,
      'createdAt': createdAt.toIso8601String(),
      'finalStatus': finalStatus.name,
      'skipReason': ?skipReason,
      'completionFeedback': ?completionFeedback,
    };
  }

  factory HistoryEntry.fromJson(Map<String, dynamic> json) {
    return HistoryEntry(
      tokenId: json['tokenId'] as String,
      queueId: json['queueId'] as String,
      queueName: json['queueName'] as String,
      serviceId: json['serviceId'] as String,
      serviceName: json['serviceName'] as String,
      // Absent on every entry stored before V2 Checkpoint 5 — defaults to
      // empty rather than failing to parse.
      additionalServiceNames:
          (json['additionalServiceNames'] as List<dynamic>?)?.map((e) => e as String).toList() ?? const [],
      serialNumber: json['serialNumber'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
      finalStatus: TokenStatus.values.firstWhere(
        (s) => s.name == json['finalStatus'],
        orElse: () => TokenStatus.unknown,
      ),
      // Absent on every entry stored before ADR-042.
      skipReason: json['skipReason'] as String?,
      completionFeedback: json['completionFeedback'] as String?,
    );
  }
}
