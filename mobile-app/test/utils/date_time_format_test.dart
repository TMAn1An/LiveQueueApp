import 'package:flutter_test/flutter_test.dart';
import 'package:intl/intl.dart';
import 'package:mobile_app/utils/date_time_format.dart';

void main() {
  group('formatLocalDateTime', () {
    // Deliberately built as "a local wall clock, expressed as the UTC
    // instant the backend would send" — so the expectation holds on any
    // machine's timezone, rather than only on the developer's.
    final localWallClock = DateTime(2026, 9, 2, 18, 30);
    String expectedFor(DateTime local) => DateFormat.yMMMd().add_jm().format(local);

    test('renders a UTC API timestamp at the device local wall clock', () {
      expect(formatLocalDateTime(localWallClock.toUtc()), expectedFor(localWallClock));
    });

    test('does not shift a value that is already local (no double conversion)', () {
      expect(formatLocalDateTime(localWallClock), expectedFor(localWallClock));
    });

    // Independent of toLocal(): fromMillisecondsSinceEpoch yields a local
    // DateTime for the same instant, so this proves the output really does
    // describe the instant the backend sent, not its UTC wall clock.
    test('an ISO-8601 "Z" string is shown as the same instant in local time', () {
      final parsed = DateTime.parse('2026-09-02T18:30:00.000Z');
      final sameInstantLocally = DateTime.fromMillisecondsSinceEpoch(parsed.millisecondsSinceEpoch);

      expect(parsed.isUtc, isTrue);
      expect(formatLocalDateTime(parsed), expectedFor(sameInstantLocally));
    });
  });
}
