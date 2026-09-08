import 'package:intl/intl.dart';

/// Formats an API timestamp for display, in the device's own timezone.
///
/// Backend timestamps arrive as ISO-8601 with an explicit `Z` (Prisma
/// `DateTime` -> JS `Date.toJSON()`), so `DateTime.parse` produces a UTC
/// `DateTime` — and `DateFormat` renders a `DateTime` in whatever zone it
/// already carries. Formatting one of those directly therefore printed the
/// UTC wall clock, which is what made History show the wrong time.
///
/// [DateTime.toLocal] is the single conversion point: it is a no-op on a
/// value that is already local, so this can never double-shift, and it
/// follows the device wherever the customer travels — no fixed offset is
/// ever assumed.
String formatLocalDateTime(DateTime value) {
  return DateFormat.yMMMd().add_jm().format(value.toLocal());
}

/// Time-of-day only ("8:35 PM"), for when the date is implied by context —
/// an estimated turn later today. Same single [DateTime.toLocal] conversion
/// as [formatLocalDateTime]: what the customer reads always matches the
/// clock on their own device, wherever they are.
String formatLocalTime(DateTime value) {
  return DateFormat.jm().format(value.toLocal());
}

/// Formats a value **as it already reads**, without converting to the device
/// zone (ADR-035).
///
/// [formatLocalDateTime] and [formatLocalTime] deliberately call `toLocal()`
/// so a UTC value from the API always prints on the customer's own clock.
/// That is exactly wrong for a value already placed in the queue's zone,
/// where converting again would undo the placement — hence these two.
String formatWallClockDateTime(DateTime value) {
  return DateFormat.yMMMd().add_jm().format(value);
}

String formatWallClockTime(DateTime value) {
  return DateFormat.jm().format(value);
}
