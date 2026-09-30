/// Phase 4 — whether a queue is currently accepting joins under its
/// (optional) weekly schedule, from GET .../config (publicQueue.service.ts's
/// `describePublicSchedule`).
///
/// Never carries capacity: a session/day full is only ever discovered by the
/// actual join attempt (queue_join_provider.dart's SCHEDULE_SESSION_FULL /
/// SCHEDULE_DAILY_CAPACITY_REACHED handling), the same way every other join
/// failure in this app works.
class QueueScheduleStatus {
  const QueueScheduleStatus({
    this.scheduleEnabled = false,
    this.isOpenNow = true,
    this.acceptingJoins = true,
    this.nextSessionStartMinute,
    this.message,
    this.todaySessions = const [],
  });

  /// False for every queue that has never turned scheduling on — joins are
  /// accepted at any time, exactly as before this feature existed.
  final bool scheduleEnabled;

  /// A session is running right now. Meaningless when [scheduleEnabled] is
  /// false (always true in that case). Informational only — [acceptingJoins]
  /// decides whether the customer may continue.
  final bool isOpenNow;

  /// ADR-048: a session remains today, so a join can still be given a place
  /// — possibly in a later session. False only when today is closed or every
  /// session has ended.
  final bool acceptingJoins;

  /// When nothing is running now: the start of the next session today, in
  /// minutes since midnight on the queue's clock.
  final int? nextSessionStartMinute;

  /// A ready-to-show sentence from the backend: why joining is refused
  /// ("This queue is closed today.") or, before the next session, that the
  /// customer will be served later today. Null while a session is running,
  /// or when scheduling is off.
  final String? message;

  /// This weekday's session windows, only when the organization has left
  /// them visible to customers (Queue.scheduleVisibleToCustomers) — empty
  /// (not necessarily closed) when hidden, so the app must not treat an
  /// empty list here as "closed today"; use [acceptingJoins] / [message] for that.
  final List<QueueSessionWindow> todaySessions;

  factory QueueScheduleStatus.fromJson(Map<String, dynamic>? json) {
    if (json == null) return const QueueScheduleStatus();
    return QueueScheduleStatus(
      scheduleEnabled: json['scheduleEnabled'] as bool? ?? false,
      isOpenNow: json['isOpenNow'] as bool? ?? true,
      // A backend older than ADR-048 gated joining on isOpenNow itself.
      acceptingJoins: json['acceptingJoins'] as bool? ?? json['isOpenNow'] as bool? ?? true,
      nextSessionStartMinute: json['nextSessionStartMinute'] as int?,
      message: json['message'] as String?,
      todaySessions: (json['todaySessions'] as List<dynamic>?)
              ?.map((e) => QueueSessionWindow.fromJson(e as Map<String, dynamic>))
              .toList() ??
          const [],
    );
  }
}

class QueueSessionWindow {
  const QueueSessionWindow({required this.startMinute, required this.endMinute, this.startsAt});

  final int startMinute;
  final int endMinute;

  /// ADR-048: on a token's assigned session, the absolute instant the session
  /// occurrence starts. Null on the public schedule preview and on tokens
  /// assigned before this existed.
  final DateTime? startsAt;

  factory QueueSessionWindow.fromJson(Map<String, dynamic> json) {
    final startsAt = json['startsAt'] as String?;
    return QueueSessionWindow(
      startMinute: json['startMinute'] as int,
      endMinute: json['endMinute'] as int,
      startsAt: startsAt == null ? null : DateTime.parse(startsAt),
    );
  }

  String get label =>
      '${_formatMinute(startMinute)}–${_formatMinute(endMinute)}';

  static String _formatMinute(int totalMinutes) {
    final hour = (totalMinutes ~/ 60).toString().padLeft(2, '0');
    final minute = (totalMinutes % 60).toString().padLeft(2, '0');
    return '$hour:$minute';
  }
}
