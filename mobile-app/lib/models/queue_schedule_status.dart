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
    this.message,
    this.todaySessions = const [],
  });

  /// False for every queue that has never turned scheduling on — joins are
  /// accepted at any time, exactly as before this feature existed.
  final bool scheduleEnabled;

  /// Meaningless when [scheduleEnabled] is false (always true in that case).
  final bool isOpenNow;

  /// A ready-to-show sentence explaining why the queue is closed right now
  /// ("This queue opens today at 09:00.", etc.) — null while open, or when
  /// scheduling is off.
  final String? message;

  /// This weekday's session windows, only when the organization has left
  /// them visible to customers (Queue.scheduleVisibleToCustomers) — empty
  /// (not necessarily closed) when hidden, so the app must not treat an
  /// empty list here as "closed today"; use [isOpenNow] / [message] for that.
  final List<QueueSessionWindow> todaySessions;

  factory QueueScheduleStatus.fromJson(Map<String, dynamic>? json) {
    if (json == null) return const QueueScheduleStatus();
    return QueueScheduleStatus(
      scheduleEnabled: json['scheduleEnabled'] as bool? ?? false,
      isOpenNow: json['isOpenNow'] as bool? ?? true,
      message: json['message'] as String?,
      todaySessions: (json['todaySessions'] as List<dynamic>?)
              ?.map((e) => QueueSessionWindow.fromJson(e as Map<String, dynamic>))
              .toList() ??
          const [],
    );
  }
}

class QueueSessionWindow {
  const QueueSessionWindow({required this.startMinute, required this.endMinute});

  final int startMinute;
  final int endMinute;

  factory QueueSessionWindow.fromJson(Map<String, dynamic> json) {
    return QueueSessionWindow(
      startMinute: json['startMinute'] as int,
      endMinute: json['endMinute'] as int,
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
