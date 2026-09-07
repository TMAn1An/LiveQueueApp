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
