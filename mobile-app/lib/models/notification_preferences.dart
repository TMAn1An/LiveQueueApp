/// Spec section 7.18: the customer's reminder time (minimum 2 minutes), plus
/// sound/vibration toggles.
///
/// ADR-062: the reminder time is optional. Null means the customer has not
/// chosen one, and each queue's own default applies — the "default reminder
/// time" staff set on the dashboard. A time chosen here always wins over
/// that default.
class NotificationPreferences {
  const NotificationPreferences({
    this.reminderMinutesBeforeTurn,
    this.soundEnabled = true,
    this.vibrationEnabled = true,
  });

  /// The one-tap choices (spec 7.18: "reasonable values such as 2, 5, 10,
  /// 15, 20"). Any whole number in range can also be entered by hand.
  static const List<int> presetReminderMinutes = [2, 5, 10, 15, 20];
  static const int minimumReminderMinutes = 2;
  static const int maximumReminderMinutes = 120;

  /// What a queue's default is assumed to be until the backend has said —
  /// the same value a new queue is created with. Only ever a stand-in: the
  /// backend's answer replaces it as soon as it arrives.
  static const int assumedQueueDefaultMinutes = 10;

  /// Null: follow each queue's default.
  final int? reminderMinutesBeforeTurn;
  final bool soundEnabled;
  final bool vibrationEnabled;

  bool get followsQueueDefault => reminderMinutesBeforeTurn == null;

  /// The reminder time in force: the customer's own, else the queue's
  /// default as last reported by the backend, else the assumed one.
  int effectiveReminderMinutes({int? queueDefaultMinutes}) =>
      reminderMinutesBeforeTurn ?? queueDefaultMinutes ?? assumedQueueDefaultMinutes;

  static bool isValidReminderMinutes(int minutes) =>
      minutes >= minimumReminderMinutes && minutes <= maximumReminderMinutes;

  /// Reads what a customer typed into the custom field. Null for anything
  /// that is not a whole number in range — decimals and signs included.
  static int? parseReminderMinutes(String input) {
    final trimmed = input.trim();
    if (!RegExp(r'^\d+$').hasMatch(trimmed)) return null;
    final minutes = int.tryParse(trimmed);
    return minutes != null && isValidReminderMinutes(minutes) ? minutes : null;
  }

  static const Object _unset = Object();

  /// [reminderMinutesBeforeTurn] accepts an explicit null — "back to the
  /// queue's default" — which an ordinary `??` fallback could not tell from
  /// "leave it as it is".
  NotificationPreferences copyWith({
    Object? reminderMinutesBeforeTurn = _unset,
    bool? soundEnabled,
    bool? vibrationEnabled,
  }) {
    return NotificationPreferences(
      reminderMinutesBeforeTurn: identical(reminderMinutesBeforeTurn, _unset)
          ? this.reminderMinutesBeforeTurn
          : reminderMinutesBeforeTurn as int?,
      soundEnabled: soundEnabled ?? this.soundEnabled,
      vibrationEnabled: vibrationEnabled ?? this.vibrationEnabled,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'reminderMinutesBeforeTurn': reminderMinutesBeforeTurn,
      'soundEnabled': soundEnabled,
      'vibrationEnabled': vibrationEnabled,
    };
  }

  /// A stored time is the customer's own choice and is kept. A missing,
  /// null or out-of-range one means "follow the queue's default".
  factory NotificationPreferences.fromJson(Map<String, dynamic> json) {
    final stored = json['reminderMinutesBeforeTurn'];
    return NotificationPreferences(
      reminderMinutesBeforeTurn: stored is int && isValidReminderMinutes(stored) ? stored : null,
      soundEnabled: json['soundEnabled'] as bool? ?? true,
      vibrationEnabled: json['vibrationEnabled'] as bool? ?? true,
    );
  }
}
