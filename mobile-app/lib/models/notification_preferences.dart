/// Spec section 7.18: reminder minutes (minimum 2; suggested values
/// 2/5/10/15/20), plus sound/vibration toggles for the turn alert.
class NotificationPreferences {
  const NotificationPreferences({
    this.reminderMinutesBeforeTurn = 5,
    this.soundEnabled = true,
    this.vibrationEnabled = true,
  });

  static const List<int> allowedReminderMinutes = [2, 5, 10, 15, 20];
  static const int minimumReminderMinutes = 2;

  final int reminderMinutesBeforeTurn;
  final bool soundEnabled;
  final bool vibrationEnabled;

  NotificationPreferences copyWith({
    int? reminderMinutesBeforeTurn,
    bool? soundEnabled,
    bool? vibrationEnabled,
  }) {
    return NotificationPreferences(
      reminderMinutesBeforeTurn: reminderMinutesBeforeTurn ?? this.reminderMinutesBeforeTurn,
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

  factory NotificationPreferences.fromJson(Map<String, dynamic> json) {
    return NotificationPreferences(
      reminderMinutesBeforeTurn: json['reminderMinutesBeforeTurn'] as int? ?? 5,
      soundEnabled: json['soundEnabled'] as bool? ?? true,
      vibrationEnabled: json['vibrationEnabled'] as bool? ?? true,
    );
  }
}
