import 'dynamic_form_field.dart';
import 'service_option.dart';

/// The public, unauthenticated queue configuration
/// (GET /api/public/queues/:queueId/config — spec section 7.16).
///
/// Note: the actual backend response (backend/src/services/publicQueue.service.ts)
/// does not include `organization_name` or a `state` block (active_tokens /
/// estimated_wait_minutes) shown in the spec's example JSON — only the
/// fields modeled below are actually returned. This is a documented,
/// pre-existing gap between the spec's example and the Phase 3
/// implementation, not something this phase changes (see PROGRESS.md).
class QueueConfig {
  const QueueConfig({
    required this.id,
    required this.name,
    required this.status,
    required this.services,
    required this.formFields,
    this.description,
    this.clientTerminology,
  });

  final String id;
  final String name;
  final String? description;
  final String status;
  final String? clientTerminology;
  final List<ServiceOption> services;
  final List<DynamicFormField> formFields;

  bool get isAcceptingCustomers => status == 'ACTIVE';

  factory QueueConfig.fromJson(Map<String, dynamic> json) {
    return QueueConfig(
      id: json['id'] as String,
      name: json['name'] as String,
      description: json['description'] as String?,
      status: json['status'] as String,
      clientTerminology: json['clientTerminology'] as String?,
      services: (json['services'] as List<dynamic>? ?? const [])
          .map((e) => ServiceOption.fromJson(e as Map<String, dynamic>))
          .toList(),
      formFields: (json['formFields'] as List<dynamic>? ?? const [])
          .map((e) => DynamicFormField.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }
}
