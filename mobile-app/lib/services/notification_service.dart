import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

/// Local (in-app-triggered) notifications for the turn alert and reminder
/// (spec section 7.18). This is the part of Phase 5 that works fully
/// standalone, with no external service.
///
/// FCM (for background push when the app has no live socket connection) is
/// intentionally NOT wired up here — see [FcmService] and
/// docs/PROGRESS.md "Known limitations" for why: it requires a real
/// Firebase project (credentials this session cannot create) and a backend
/// push-dispatch job that is explicitly Phase 7 scope
/// (IMPLEMENTATION_PLAN.md), not Phase 5.
class NotificationService {
  final FlutterLocalNotificationsPlugin _plugin = FlutterLocalNotificationsPlugin();
  bool _initialized = false;

  static const _turnAlertChannel = AndroidNotificationChannel(
    'turn_alert',
    'Turn Alerts',
    description: 'Notifies you when it is your turn',
    importance: Importance.max,
  );

  static const _generalChannel = AndroidNotificationChannel(
    'queue_updates',
    'Queue Updates',
    description: 'Reminders and queue status updates',
    importance: Importance.high,
  );

  Future<void> initialize() async {
    if (_initialized) return;

    const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
    const iosInit = DarwinInitializationSettings(
      requestAlertPermission: false,
      requestBadgePermission: false,
      requestSoundPermission: false,
    );
    const initSettings = InitializationSettings(android: androidInit, iOS: iosInit);

    await _plugin.initialize(settings: initSettings);

    final androidPlugin = _plugin.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    await androidPlugin?.createNotificationChannel(_turnAlertChannel);
    await androidPlugin?.createNotificationChannel(_generalChannel);

    _initialized = true;
  }

  Future<bool> requestPermission() async {
    if (Platform.isIOS) {
      final iosPlugin = _plugin.resolvePlatformSpecificImplementation<
          IOSFlutterLocalNotificationsPlugin>();
      final granted = await iosPlugin?.requestPermissions(alert: true, badge: true, sound: true);
      return granted ?? false;
    }
    if (Platform.isAndroid) {
      final androidPlugin = _plugin.resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin>();
      final granted = await androidPlugin?.requestNotificationsPermission();
      return granted ?? false;
    }
    return true;
  }

  /// Spec section 7.18 "Turn alert": "When a token becomes CALLED... show a
  /// notification, vibrate if permitted, play a notification sound if
  /// permitted."
  Future<void> showTurnAlert({
    required String serialNumber,
    required String? counterName,
    required bool soundEnabled,
    required bool vibrationEnabled,
  }) async {
    await _show(
      channel: _turnAlertChannel,
      title: "It's your turn!",
      body: counterName != null
          ? 'Token $serialNumber — please go to $counterName.'
          : 'Token $serialNumber — please proceed.',
      soundEnabled: soundEnabled,
      vibrationEnabled: vibrationEnabled,
    );
  }

  Future<void> showReminder({
    required String serialNumber,
    required int estimatedWaitMinutes,
    required bool soundEnabled,
    required bool vibrationEnabled,
  }) async {
    await _show(
      channel: _generalChannel,
      title: 'Almost your turn',
      body: 'Token $serialNumber — about $estimatedWaitMinutes minute(s) left.',
      soundEnabled: soundEnabled,
      vibrationEnabled: vibrationEnabled,
    );
  }

  Future<void> showQueueStatusNotice({required String queueName, required bool paused}) async {
    await _show(
      channel: _generalChannel,
      title: paused ? 'Queue paused' : 'Queue resumed',
      body: paused
          ? '$queueName has been paused by staff.'
          : '$queueName is accepting customers again.',
      soundEnabled: false,
      vibrationEnabled: false,
    );
  }

  Future<void> showTokenSkippedNotice({required String serialNumber}) async {
    await _show(
      channel: _generalChannel,
      title: 'Token skipped',
      body: 'Token $serialNumber was skipped.',
      soundEnabled: false,
      vibrationEnabled: false,
    );
  }

  Future<void> _show({
    required AndroidNotificationChannel channel,
    required String title,
    required String body,
    required bool soundEnabled,
    required bool vibrationEnabled,
  }) async {
    if (!_initialized) {
      // Never let a missing initialize() call crash a live-tracking update.
      if (kDebugMode) {
        debugPrint('NotificationService.initialize() was not called; skipping notification.');
      }
      return;
    }

    final androidDetails = AndroidNotificationDetails(
      channel.id,
      channel.name,
      channelDescription: channel.description,
      importance: channel.importance,
      priority: Priority.high,
      playSound: soundEnabled,
      enableVibration: vibrationEnabled,
    );
    final iosDetails = DarwinNotificationDetails(presentSound: soundEnabled);

    await _plugin.show(
      id: DateTime.now().millisecondsSinceEpoch.remainder(1 << 31),
      title: title,
      body: body,
      notificationDetails: NotificationDetails(android: androidDetails, iOS: iosDetails),
    );
  }
}
