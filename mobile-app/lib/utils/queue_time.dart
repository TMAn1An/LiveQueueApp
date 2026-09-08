import 'package:timezone/data/latest_10y.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

import 'date_time_format.dart';

/// Showing a moment on two clocks at once: the queue's, and the customer's
/// (ADR-035).
///
/// A queue's times belong to the queue. Someone tracking a token from another
/// country needs to know both — when the counter expects them in the queue's
/// own working day, and what that is on the phone in their hand. Showing only
/// one of the two is how a customer misses their turn by six hours.
///
/// The tz database is needed because Dart's core `DateTime` can convert to
/// UTC and to the device's own zone, and nothing else. `timezone` was already
/// pulled in transitively; this promotes it to a direct dependency rather
/// than adding weight.

bool _initialized = false;

/// Idempotent, and safe to call before every use — the package's own
/// initializer is cheap after the first call, and this keeps callers from
/// having to remember a startup step that would only fail in production.
void _ensureInitialized() {
  if (_initialized) return;
  tzdata.initializeTimeZones();
  _initialized = true;
}

/// A moment rendered on both clocks, with a flag for whether they agree.
class DualTime {
  const DualTime({
    required this.local,
    required this.queue,
    required this.timezoneName,
    required this.differs,
  });

  /// On the customer's own device, always present.
  final String local;

  /// On the queue's clock. Null when the queue has no timezone set, or the
  /// name is one this build's tz database does not know — in which case the
  /// app shows the customer's time alone rather than a guess.
  final String? queue;

  final String? timezoneName;

  /// Whether the two readings are genuinely different. When they are not,
  /// the UI shows one line: two identical rows labelled differently is
  /// clutter that makes the screen harder to read, not clearer.
  final bool differs;
}

/// Formats [instant] for both clocks. [timezoneName] is the queue's IANA
/// zone, straight from the backend — never the device's own, and never
/// guessed.
DualTime dualTime(
  DateTime instant, {
  required String? timezoneName,
  bool dateAndTime = false,
}) {
  final local = dateAndTime ? formatLocalDateTime(instant) : formatLocalTime(instant);

  if (timezoneName == null || timezoneName.isEmpty) {
    return DualTime(local: local, queue: null, timezoneName: null, differs: false);
  }

  try {
    _ensureInitialized();
    final location = tz.getLocation(timezoneName);
    final inQueueZone = tz.TZDateTime.from(instant, location);
    // Formatted from the queue-zone wall clock. The formatter renders
    // whatever zone the value carries, so this prints the queue's reading
    // rather than the device's.
    final queue = dateAndTime
        ? formatWallClockDateTime(inQueueZone)
        : formatWallClockTime(inQueueZone);
    return DualTime(
      local: local,
      queue: queue,
      timezoneName: timezoneName,
      differs: queue != local,
    );
  } catch (_) {
    // An unknown zone name is not worth failing a screen over; the
    // customer's own time is still correct and still useful.
    return DualTime(local: local, queue: null, timezoneName: null, differs: false);
  }
}
