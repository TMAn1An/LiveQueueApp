import 'dynamic_form_field.dart';
import 'queue_identity_requirements.dart';
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
    this.allowMultipleServices = true,
    this.identity = const QueueIdentityRequirements(),
    this.timezone,
  });

  final String id;
  final String name;
  final String? description;
  final String status;
  final String? clientTerminology;
  final List<ServiceOption> services;
  final List<DynamicFormField> formFields;
  /// V2 Checkpoint 6: when false, the join flow must present a single-select
  /// (radio-style) service picker instead of the default checkbox
  /// multi-select. The backend remains authoritative regardless of what the
  /// UI shows — this only drives which widget renders.
  final bool allowMultipleServices;

  /// ADR-034 — what this queue needs to recognise the customer, if it limits
  /// repeat visits. Drives whether the join flow asks for a verified phone
  /// number, and whether it should refuse to start at all.
  final QueueIdentityRequirements identity;

  /// ADR-035 — the IANA zone this queue runs in, so the app can show the
  /// queue's own clock beside the customer's. A fact about the queue, never
  /// derived from the device. Null when the organization has not set one, in
  /// which case only the customer's local time is shown.
  final String? timezone;

  bool get isAcceptingCustomers => status == 'ACTIVE';

  factory QueueConfig.fromJson(Map<String, dynamic> json) {
    return QueueConfig(
      id: json['id'] as String,
      name: json['name'] as String,
      description: json['description'] as String?,
      status: json['status'] as String,
      clientTerminology: json['clientTerminology'] as String?,
      allowMultipleServices: json['allowMultipleServices'] as bool? ?? true,
      timezone: json['timezone'] as String?,
      identity: QueueIdentityRequirements.fromJson(
        (json['identity'] as Map<String, dynamic>?) ?? const {},
      ),
      services: (json['services'] as List<dynamic>? ?? const [])
          .map((e) => ServiceOption.fromJson(e as Map<String, dynamic>))
          .toList(),
      formFields: (json['formFields'] as List<dynamic>? ?? const [])
          .map((e) => DynamicFormField.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }
}
