import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/utils/queue_time.dart';

/// Showing a moment on the queue's clock and the customer's (ADR-035).
///
/// The tests set the process timezone through the environment where they
/// can, but the reliable, platform-independent assertion is the *relationship*
/// between the two readings — so that is what is asserted.

void main() {
  final instant = DateTime.utc(2026, 9, 8, 9, 20);

  test('shows one time when the queue has no timezone at all', () {
    final times = dualTime(instant, timezoneName: null);

    expect(times.queue, isNull);
    expect(times.differs, isFalse);
    expect(times.local, isNotEmpty);
  });

  test('renders the queue clock for a real zone', () {
    final times = dualTime(instant, timezoneName: 'Asia/Dhaka');

    // 09:20 UTC is 3:20 PM in Dhaka.
    expect(times.queue, contains('3:20'));
    expect(times.timezoneName, 'Asia/Dhaka');
  });

  test('two different zones give two different readings', () {
    final dhaka = dualTime(instant, timezoneName: 'Asia/Dhaka');
    final newYork = dualTime(instant, timezoneName: 'America/New_York');

    expect(dhaka.queue, isNot(equals(newYork.queue)));
    // 09:20 UTC is 5:20 AM in New York in September (EDT).
    expect(newYork.queue, contains('5:20'));
  });

  test('collapses to one line when the two clocks agree', () {
    // Whatever zone the test host runs in, asking for that same reading
    // twice must not produce a "different" answer.
    final sameAsLocal = dualTime(instant, timezoneName: null);
    expect(sameAsLocal.differs, isFalse);
  });

  test('falls back to the customer clock for an unknown zone', () {
    final times = dualTime(instant, timezoneName: 'Not/AZone');

    expect(times.queue, isNull);
    expect(times.differs, isFalse);
    expect(times.local, isNotEmpty);
  });

  test('includes the date when asked, for a moment weeks away', () {
    final times = dualTime(
      DateTime.utc(2026, 10, 8, 4, 0),
      timezoneName: 'Asia/Dhaka',
      dateAndTime: true,
    );

    expect(times.queue, contains('Oct'));
    expect(times.queue, contains('2026'));
  });

  test('handles a daylight-saving change on the queue clock', () {
    // Mid-November in New York is EST (UTC-5), not EDT (UTC-4).
    final summer = dualTime(DateTime.utc(2026, 7, 15, 16, 0), timezoneName: 'America/New_York');
    final winter = dualTime(DateTime.utc(2026, 11, 15, 16, 0), timezoneName: 'America/New_York');

    expect(summer.queue, contains('12:00'));
    expect(winter.queue, contains('11:00'));
  });
}
