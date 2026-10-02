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

  static const _turnAlertChannel = _ChannelKind(
    id: 'turn_alert',
    name: 'Turn Alerts',
    description: 'Notifies you when it is your turn',
    importance: Importance.max,
  );

  static const _generalChannel = _ChannelKind(
    id: 'queue_updates',
    name: 'Queue Updates',
    description: 'Reminders and queue status updates',
    importance: Importance.high,
  );

  /// The customer's Sound / Vibration switches, as last applied by
  /// [applyAlertPreferences]. Used for notifications whose caller has no
  /// preferences of its own to pass (a foreground push), and to decide which
  /// channels must exist before a push can arrive with the app closed.
  bool _soundEnabled = true;
  bool _vibrationEnabled = true;

  final Set<String> _createdChannelIds = {};
  final Set<String> _remindedTokenIds = {};

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

    _initialized = true;
    await _ensureCurrentChannels();
  }

  /// Makes the Sound and Vibration switches take effect (ADR-062).
  ///
  /// Since Android 8 a notification cannot choose its own sound or
  /// vibration: both belong to the channel it is posted on, and are fixed
  /// when that channel is created. So each combination of the two switches
  /// has its own channel, and "sound off" means posting to a channel that
  /// was created silent. The ids are shared with the backend
  /// (backend/src/utils/notificationChannel.ts), which names the matching
  /// channel on pushes the system shows while the app is closed — which is
  /// why the channels for the current choice are created here, ahead of any
  /// notification, rather than lazily.
  Future<void> applyAlertPreferences({
    required bool soundEnabled,
    required bool vibrationEnabled,
  }) async {
    _soundEnabled = soundEnabled;
    _vibrationEnabled = vibrationEnabled;
    await _ensureCurrentChannels();
  }

  Future<void> _ensureCurrentChannels() async {
    if (!_initialized) return;
    for (final kind in const [_turnAlertChannel, _generalChannel]) {
      await _ensureChannel(kind, soundEnabled: _soundEnabled, vibrationEnabled: _vibrationEnabled);
    }
  }

  Future<AndroidNotificationChannel> _ensureChannel(
    _ChannelKind kind, {
    required bool soundEnabled,
    required bool vibrationEnabled,
  }) async {
    final channel = kind.variant(soundEnabled: soundEnabled, vibrationEnabled: vibrationEnabled);
    if (_createdChannelIds.add(channel.id)) {
      final androidPlugin = _plugin.resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin>();
      await androidPlugin?.createNotificationChannel(channel);
    }
    return channel;
  }

  /// Whether notifications are currently allowed, without asking — so a
  /// settings screen can show the real state instead of assuming "off" until
  /// the customer taps. False if the platform cannot say.
  Future<bool> areNotificationsEnabled() async {
    try {
      if (Platform.isAndroid) {
        final androidPlugin = _plugin.resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin>();
        return await androidPlugin?.areNotificationsEnabled() ?? false;
      }
      if (Platform.isIOS) {
        final iosPlugin = _plugin.resolvePlatformSpecificImplementation<
            IOSFlutterLocalNotificationsPlugin>();
        return (await iosPlugin?.checkPermissions())?.isEnabled ?? false;
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  /// Claims the one "almost your turn" reminder for [tokenId]. True the
  /// first time, false ever after — the app can hear about the same
  /// reminder twice (its own, raised while Live Tracking is open, and the
  /// backend's push), and whichever arrives second must stay quiet.
  bool claimReminder(String tokenId) => _remindedTokenIds.add(tokenId);

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

  /// Displays an incoming FCM foreground message (spec 7.18's notification
  /// types, once the backend actually dispatches them — Phase 7 backend
  /// scope, not yet implemented). Android/iOS both suppress the automatic
  /// system notification for a foreground app, so FCM's `onMessage` must
  /// explicitly show one — this reuses the same plugin instance/channel as
  /// every other notification here rather than standing up a second
  /// notification system. Kept generic (title/body only, no payload
  /// routing) because no backend FCM payload contract exists yet.
  Future<void> showGenericNotification({required String title, required String body}) async {
    await _show(
      channel: _generalChannel,
      title: title,
      body: body,
      soundEnabled: _soundEnabled,
      vibrationEnabled: _vibrationEnabled,
    );
  }

  Future<void> showQueueStatusNotice({required String queueName, required bool paused}) async {
    await _show(
      channel: _generalChannel,
      title: paused ? 'Queue paused' : 'Queue resumed',
      body: paused
          ? '$queueName has been paused by staff.'
          : '$queueName is open to join again.',
      soundEnabled: false,
      vibrationEnabled: false,
    );
  }

  Future<void> showTokenSkippedNotice({required String serialNumber}) async {
    await _show(
      channel: _generalChannel,
      title: 'Token skipped',
      body: 'Token $serialNumber was skipped. Scan the queue QR code again if you still need service.',
      soundEnabled: false,
      vibrationEnabled: false,
    );
  }

  Future<void> _show({
    required _ChannelKind channel,
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

    final androidChannel = await _ensureChannel(
      channel,
      soundEnabled: soundEnabled,
      vibrationEnabled: vibrationEnabled,
    );
    final androidDetails = AndroidNotificationDetails(
      androidChannel.id,
      androidChannel.name,
      channelDescription: androidChannel.description,
      importance: androidChannel.importance,
      priority: Priority.high,
      // Honoured directly below Android 8; from Android 8 on it is the
      // channel chosen above that decides.
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

/// The channel id for one kind of notification under one combination of the
/// Sound and Vibration switches. A contract with the backend, which builds
/// the same id for pushes shown while the app is closed
/// (backend/src/utils/notificationChannel.ts) — change both or neither.
String androidChannelId(
  String baseId, {
  required bool soundEnabled,
  required bool vibrationEnabled,
}) {
  if (soundEnabled && vibrationEnabled) return baseId;
  if (soundEnabled) return '${baseId}_sound_only';
  if (vibrationEnabled) return '${baseId}_vibrate_only';
  return '${baseId}_silent';
}

/// One kind of notification, and the Android channel for each combination of
/// the Sound and Vibration switches. The both-on channel keeps the plain id
/// the app has always used, so an existing install's channel settings carry
/// over untouched.
class _ChannelKind {
  const _ChannelKind({
    required this.id,
    required this.name,
    required this.description,
    required this.importance,
  });

  final String id;
  final String name;
  final String description;
  final Importance importance;

  AndroidNotificationChannel variant({required bool soundEnabled, required bool vibrationEnabled}) {
    final label = switch ((soundEnabled, vibrationEnabled)) {
      (true, true) => '',
      (true, false) => ' (sound only)',
      (false, true) => ' (vibration only)',
      (false, false) => ' (silent)',
    };
    return AndroidNotificationChannel(
      androidChannelId(id, soundEnabled: soundEnabled, vibrationEnabled: vibrationEnabled),
      '$name$label',
      description: description,
      importance: importance,
      playSound: soundEnabled,
      enableVibration: vibrationEnabled,
    );
  }
}
