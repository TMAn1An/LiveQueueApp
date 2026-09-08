import 'package:flutter/material.dart';

import '../utils/queue_time.dart';

/// One moment, shown on the queue's clock and the customer's (ADR-035).
///
/// Collapses to a single line whenever the two readings are the same, which
/// is the overwhelmingly common case — a customer standing in the building.
/// Two identically-valued rows labelled "Queue time" and "Your time" would be
/// noise that makes the screen harder to read, not more informative. The
/// second line appears only when it carries actual information: that the
/// queue's day and the customer's are not the same.
class DualTimeRow extends StatelessWidget {
  const DualTimeRow({
    super.key,
    required this.label,
    required this.instant,
    required this.timezoneName,
    this.dateAndTime = false,
  });

  final String label;
  final DateTime instant;

  /// The queue's IANA zone, straight from the backend. Null simply means the
  /// organization never set one, and only the customer's time is shown.
  final String? timezoneName;

  final bool dateAndTime;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final times = dualTime(instant, timezoneName: timezoneName, dateAndTime: dateAndTime);

    if (!times.differs) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(label, style: theme.textTheme.bodyMedium),
            Text(times.local, style: theme.textTheme.titleMedium),
          ],
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: theme.textTheme.bodyMedium),
          const SizedBox(height: 4),
          _Line(
            caption: 'Queue time${times.timezoneName != null ? ' (${times.timezoneName})' : ''}',
            value: times.queue!,
            emphasised: true,
          ),
          _Line(caption: 'Your local time', value: times.local, emphasised: false),
        ],
      ),
    );
  }
}

class _Line extends StatelessWidget {
  const _Line({required this.caption, required this.value, required this.emphasised});

  final String caption;
  final String value;
  final bool emphasised;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(top: 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(caption, style: theme.textTheme.bodySmall),
          Text(
            value,
            style: emphasised
                ? theme.textTheme.titleSmall
                : theme.textTheme.bodyMedium,
          ),
        ],
      ),
    );
  }
}
