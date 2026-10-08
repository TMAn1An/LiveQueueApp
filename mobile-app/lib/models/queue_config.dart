import 'dynamic_form_field.dart';
import 'queue_identity_requirements.dart';
import 'queue_schedule_status.dart';
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
    this.schedule = const QueueScheduleStatus(),
    this.recommendedJourney = const [],
  });

  /// ADR-070: the order the queue suggests services be taken in (service
  /// ids, may repeat). The join flow starts from it; empty when none is set
  /// or from a backend that predates it.
  final List<String> recommendedJourney;

  final String id;
  final String name;
  final String? description;
  final String status;
  final String? clientTerminology;
  final List<ServiceOption> services;
  final List<DynamicFormField> formFields;
  /// Retired by ADR-071 D1: every queue accepts one service or many and the
  /// backend always reports true. Parsed (default true) only so older
  /// payloads keep decoding; nothing in the join flow reads it.
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

  /// Phase 4 — whether this queue's optional weekly schedule currently
  /// allows a join. Always accepting for every queue that has never turned
  /// scheduling on.
  final QueueScheduleStatus schedule;

  /// ADR-048: a scheduled queue accepts joins while any session remains
  /// today — a customer scanning before a session opens is given a place in
  /// it rather than turned away.
  bool get isAcceptingCustomers => status == 'ACTIVE' && schedule.acceptingJoins;

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
      schedule: QueueScheduleStatus.fromJson(json['schedule'] as Map<String, dynamic>?),
      recommendedJourney: (json['recommendedJourney'] as List<dynamic>? ?? const [])
          .whereType<String>()
          .toList(),
      services: (json['services'] as List<dynamic>? ?? const [])
          .map((e) => ServiceOption.fromJson(e as Map<String, dynamic>))
          .toList(),
      formFields: (json['formFields'] as List<dynamic>? ?? const [])
          .map((e) => DynamicFormField.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }
}
