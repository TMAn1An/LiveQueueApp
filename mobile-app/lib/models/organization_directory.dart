/// ADR-068: what an organization's public QR resolves to —
/// GET /api/public/organizations/:publicCode. The backend decides which
/// queues are listed and whether each can be joined; the app only shows it.
class OrganizationDirectory {
  const OrganizationDirectory({
    required this.name,
    required this.publicCode,
    required this.queues,
  });

  final String name;
  final String publicCode;
  final List<OrganizationQueueSummary> queues;

  factory OrganizationDirectory.fromJson(Map<String, dynamic> json) {
    final organization = json['organization'] as Map<String, dynamic>;
    return OrganizationDirectory(
      name: organization['name'] as String,
      publicCode: organization['publicCode'] as String,
      queues: (json['queues'] as List<dynamic>)
          .map((q) => OrganizationQueueSummary.fromJson(q as Map<String, dynamic>))
          .toList(),
    );
  }
}

class OrganizationQueueSummary {
  const OrganizationQueueSummary({
    required this.id,
    required this.name,
    required this.description,
    required this.isJoinable,
    required this.message,
    required this.waitingCount,
    required this.estimatedWaitMinutes,
  });

  final String id;
  final String name;
  final String? description;

  /// `availability == 'JOINABLE'`. A closed queue is still listed, with
  /// [message] saying why or when it opens.
  final bool isJoinable;
  final String? message;
  final int waitingCount;
  final int? estimatedWaitMinutes;

  factory OrganizationQueueSummary.fromJson(Map<String, dynamic> json) {
    return OrganizationQueueSummary(
      id: json['id'] as String,
      name: json['name'] as String,
      description: json['description'] as String?,
      isJoinable: json['availability'] == 'JOINABLE',
      message: json['message'] as String?,
      waitingCount: (json['waitingCount'] as num?)?.toInt() ?? 0,
      estimatedWaitMinutes: (json['estimatedWaitMinutes'] as num?)?.toInt(),
    );
  }
}
