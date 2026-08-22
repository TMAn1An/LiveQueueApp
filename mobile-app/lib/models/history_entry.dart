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
    required this.serialNumber,
    required this.createdAt,
    required this.finalStatus,
  });

  final String tokenId;
  final String queueId;
  final String queueName;
  final String serviceId;
  final String serviceName;
  final String serialNumber;
  final DateTime createdAt;
  final TokenStatus finalStatus;

  HistoryEntry copyWith({TokenStatus? finalStatus}) {
    return HistoryEntry(
      tokenId: tokenId,
      queueId: queueId,
      queueName: queueName,
      serviceId: serviceId,
      serviceName: serviceName,
      serialNumber: serialNumber,
      createdAt: createdAt,
      finalStatus: finalStatus ?? this.finalStatus,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'tokenId': tokenId,
      'queueId': queueId,
      'queueName': queueName,
      'serviceId': serviceId,
      'serviceName': serviceName,
      'serialNumber': serialNumber,
      'createdAt': createdAt.toIso8601String(),
      'finalStatus': finalStatus.name,
    };
  }

  factory HistoryEntry.fromJson(Map<String, dynamic> json) {
    return HistoryEntry(
      tokenId: json['tokenId'] as String,
      queueId: json['queueId'] as String,
      queueName: json['queueName'] as String,
      serviceId: json['serviceId'] as String,
      serviceName: json['serviceName'] as String,
      serialNumber: json['serialNumber'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
      finalStatus: TokenStatus.values.firstWhere(
        (s) => s.name == json['finalStatus'],
        orElse: () => TokenStatus.unknown,
      ),
    );
  }
}
