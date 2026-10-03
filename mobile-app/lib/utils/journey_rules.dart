/// ADR-070: an ordered service journey — the services a person takes, in the
/// order they take them. A copy of the backend's validateJourneySteps
/// (backend/src/services/journey.service.ts), so the app can explain a
/// problem while the person arranges their steps. The backend is what
/// enforces it.
library;

const int maxJourneySteps = 20;
const int defaultMaxOccurrences = 2;

class JourneyServiceRule {
  const JourneyServiceRule({required this.id, required this.name, this.maxOccurrences = defaultMaxOccurrences});

  final String id;
  final String name;
  final int maxOccurrences;
}

class JourneyProblem {
  const JourneyProblem(this.code, this.message, {this.stepNumber});

  final String code;
  final String message;

  /// 1-based step the problem is at, when it is about one step.
  final int? stepNumber;
}

/// Every rule the steps break, in order (empty = fine).
List<JourneyProblem> journeyProblems(List<String> steps, List<JourneyServiceRule> services) {
  final byId = {for (final s in services) s.id: s};
  String nameOf(String id) => byId[id]?.name ?? 'This service';
  final problems = <JourneyProblem>[];
  if (steps.isEmpty) {
    problems.add(const JourneyProblem('JOURNEY_EMPTY', 'Select at least one service.'));
  }
  if (steps.length > maxJourneySteps) {
    problems.add(const JourneyProblem('JOURNEY_TOO_LONG', 'A visit can have at most $maxJourneySteps steps.'));
  }
  for (var i = 1; i < steps.length; i++) {
    if (steps[i] == steps[i - 1]) {
      problems.add(JourneyProblem(
        'JOURNEY_CONSECUTIVE_REPEAT',
        "${nameOf(steps[i])} can't be two steps in a row.",
        stepNumber: i + 1,
      ));
    }
  }
  final counts = <String, int>{};
  for (final id in steps) {
    counts[id] = (counts[id] ?? 0) + 1;
  }
  counts.forEach((id, count) {
    final limit = byId[id]?.maxOccurrences ?? defaultMaxOccurrences;
    if (count > limit) {
      problems.add(JourneyProblem(
        'JOURNEY_REPEAT_LIMIT',
        '${nameOf(id)} can be chosen at most $limit ${limit == 1 ? 'time' : 'times'}.',
      ));
    }
  });
  return problems;
}

/// Whether adding [serviceId] at the end keeps the journey valid.
bool canAppendStep(List<String> steps, String serviceId, List<JourneyServiceRule> services) {
  if (steps.length >= maxJourneySteps) return false;
  if (steps.isNotEmpty && steps.last == serviceId) return false;
  final used = steps.where((id) => id == serviceId).length;
  final rule = services.where((s) => s.id == serviceId);
  final limit = rule.isEmpty ? defaultMaxOccurrences : rule.first.maxOccurrences;
  return used < limit;
}

/// [steps] with the item at [from] moved to [to].
List<T> reorderStep<T>(List<T> steps, int from, int to) {
  if (from == to || from < 0 || from >= steps.length || to < 0 || to >= steps.length) return steps;
  final next = [...steps];
  final item = next.removeAt(from);
  next.insert(to, item);
  return next;
}
