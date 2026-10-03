/// ADR-070: a token's ordered journey as the customer sees it — read-only.
/// The order was fixed when the token was created.
class JourneyStepView {
  const JourneyStepView({
    required this.stepNumber,
    required this.serviceName,
    required this.status,
    this.counterName,
  });

  final int stepNumber;
  final String serviceName;

  /// PENDING, CALLED, IN_PROGRESS, COMPLETED, SKIPPED or CANCELLED.
  final String status;
  final String? counterName;

  bool get isDone => status == 'COMPLETED';

  factory JourneyStepView.fromJson(Map<String, dynamic> json) => JourneyStepView(
        stepNumber: json['stepNumber'] as int,
        serviceName: json['serviceName'] as String,
        status: json['status'] as String,
        counterName: (json['counter'] as Map<String, dynamic>?)?['name'] as String?,
      );
}

class TokenJourney {
  const TokenJourney({
    required this.totalSteps,
    required this.currentStepNumber,
    required this.steps,
    this.referredToCounterName,
  });

  final int totalSteps;
  final int currentStepNumber;
  final List<JourneyStepView> steps;

  /// The counter this step was referred to, if an operator referred it.
  final String? referredToCounterName;

  JourneyStepView? get current =>
      steps.where((s) => s.stepNumber == currentStepNumber).firstOrNull;
  JourneyStepView? get next =>
      steps.where((s) => s.stepNumber == currentStepNumber + 1).firstOrNull;

  static TokenJourney? fromJson(Map<String, dynamic>? json) {
    if (json == null) return null;
    return TokenJourney(
      totalSteps: json['totalSteps'] as int,
      currentStepNumber: json['currentStepNumber'] as int,
      steps: (json['steps'] as List<dynamic>? ?? const [])
          .map((e) => JourneyStepView.fromJson(e as Map<String, dynamic>))
          .toList(),
      referredToCounterName: (json['referredTo'] as Map<String, dynamic>?)?['name'] as String?,
    );
  }
}
