import 'live_queue_token.dart';

/// The backend's answer when the app registers a token's notification
/// preferences (ADR-062): the reminder time actually in force, where it came
/// from, and how far away the token's turn currently is.
///
/// The app shows this rather than working any of it out itself — whether the
/// customer's time or the queue's default applies is the backend's decision.
class TokenReminderStatus {
  const TokenReminderStatus({
    required this.tokenId,
    required this.reminderMinutes,
    required this.followsQueueDefault,
    required this.queueDefaultReminderMinutes,
    required this.status,
    required this.estimatedWaitMinutes,
  });

  final String tokenId;

  /// The reminder time in force for this token.
  final int reminderMinutes;
  final bool followsQueueDefault;
  final int queueDefaultReminderMinutes;
  final TokenStatus status;

  /// Null when the backend has no estimate (no counter open, or the token is
  /// no longer waiting).
  final int? estimatedWaitMinutes;

  /// True when the turn is already closer than the reminder time, so the
  /// reminder cannot give that much notice.
  bool get waitIsShorterThanReminder => reminderLeadIsTooShort(
        status: status,
        estimatedWaitMinutes: estimatedWaitMinutes,
        reminderMinutes: reminderMinutes,
      );

  factory TokenReminderStatus.fromJson(Map<String, dynamic> json) {
    return TokenReminderStatus(
      tokenId: json['tokenId'] as String,
      reminderMinutes: json['reminderMinutes'] as int,
      followsQueueDefault: json['reminderSource'] == 'QUEUE_DEFAULT',
      queueDefaultReminderMinutes:
          json['queueDefaultReminderMinutes'] as int? ?? json['reminderMinutes'] as int,
      status: parseTokenStatus(json['status'] as String? ?? ''),
      estimatedWaitMinutes: json['estimatedWaitMinutes'] as int?,
    );
  }
}

/// A reminder of N minutes can only be given N minutes ahead if the turn is
/// still at least that far away. The one definition of "too short", shared by
/// Live Tracking and Notification Settings.
bool reminderLeadIsTooShort({
  required TokenStatus status,
  required int? estimatedWaitMinutes,
  required int reminderMinutes,
}) {
  return status == TokenStatus.waiting &&
      estimatedWaitMinutes != null &&
      estimatedWaitMinutes < reminderMinutes;
}
