import 'live_queue_token.dart';

/// One entry in the customer-facing in-app Notification Center (V2 Product
/// Completion checkpoint, Part D) — separate from an Android push
/// notification, which can be dismissed, missed while the app was already
/// open, or never delivered at all (no FCM token registered). This is what
/// lets a customer open LiveQueue and see what actually happened, regardless
/// of whether any push reached the device.
///
/// Deliberately minimal fields: a token serial, a queue name, a status and a
/// short generic sentence. Never a form answer, an email address, an OTP, a
/// verification proof, or any internal identity fingerprint — the same
/// privacy discipline the FCM payload itself already follows (see
/// tokenNotificationDispatch.service.ts on the backend).
enum NotificationKind { joined, statusChanged, etaChanged, reminder }

class AppNotification {
  const AppNotification({
    required this.id,
    required this.tokenId,
    required this.kind,
    required this.title,
    required this.body,
    required this.createdAt,
    this.status,
    this.read = false,
  });

  /// Stable dedup identity — see NotificationCenterProvider. Two entries
  /// built from the same underlying event always produce the same id,
  /// however many of Socket.io, FCM, or a plain resync happened to notice it
  /// first; recording the second is then a no-op rather than a duplicate row.
  final String id;

  /// Whose notification this is. Never a global "current token" — with
  /// multiple active tokens, this is the only thing that says which one a
  /// tap should open (checkpoint Part D, "never use a global current-token
  /// pointer").
  final String tokenId;

  final NotificationKind kind;
  final String title;
  final String body;
  final DateTime createdAt;
  final TokenStatus? status;
  final bool read;

  AppNotification copyWith({bool? read}) {
    return AppNotification(
      id: id,
      tokenId: tokenId,
      kind: kind,
      title: title,
      body: body,
      createdAt: createdAt,
      status: status,
      read: read ?? this.read,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'tokenId': tokenId,
        'kind': kind.name,
        'title': title,
        'body': body,
        'createdAt': createdAt.toIso8601String(),
        'status': status?.name,
        'read': read,
      };

  /// Never throws: one corrupt stored entry is skipped by the caller, not
  /// allowed to take the rest of the notification list down with it.
  static AppNotification fromJson(Map<String, dynamic> json) {
    return AppNotification(
      id: json['id'] as String,
      tokenId: json['tokenId'] as String,
      kind: _kindByName(json['kind'] as String?),
      title: json['title'] as String? ?? '',
      body: json['body'] as String? ?? '',
      createdAt: DateTime.parse(json['createdAt'] as String),
      status: json['status'] == null ? null : _statusByName(json['status'] as String),
      read: json['read'] as bool? ?? false,
    );
  }

  static NotificationKind _kindByName(String? name) {
    for (final value in NotificationKind.values) {
      if (value.name == name) return value;
    }
    return NotificationKind.statusChanged;
  }

  static TokenStatus _statusByName(String name) {
    for (final value in TokenStatus.values) {
      if (value.name == name) return value;
    }
    return TokenStatus.unknown;
  }
}
