import 'package:flutter/material.dart';

import '../models/queue_config.dart';
import '../utils/queue_time.dart';

/// What a customer is told about a queue: its name, and anything that
/// decides whether — or how often — it can be joined (ADR-063).
///
/// Before a join it heads the service list, where the Queue Details screen
/// used to stand between the scan and the services — the same facts are
/// still read before anything is filled in, one tap sooner. After a join it
/// opens the Queue Details screen reached from Live Tracking.
class QueueJoinSummary extends StatelessWidget {
  const QueueJoinSummary({
    super.key,
    required this.config,
    required this.needsIdentitySetup,
  });

  final QueueConfig config;

  /// The queue limits repeat visits but has not been told how to recognise
  /// customers, so the backend refuses every join (ADR-034).
  final bool needsIdentitySetup;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final schedule = config.schedule;
    final blocked = joinBlockedNotice(config, needsIdentitySetup: needsIdentitySetup);
    final repeatNotice = blocked == null ? repeatVisitNotice(config) : null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(config.name, style: theme.textTheme.headlineSmall),
        if (config.description != null) ...[
          const SizedBox(height: 8),
          Text(config.description!),
        ],
        if (blocked != null) ...[
          const SizedBox(height: 16),
          _Notice(text: blocked),
        ] else if (repeatNotice != null) ...[
          const SizedBox(height: 16),
          _Notice(text: repeatNotice),
        ],
        // ADR-048: before the next session starts the queue still accepts
        // joins — the customer is told they will be served later today, not
        // turned away.
        if (schedule.scheduleEnabled &&
            schedule.acceptingJoins &&
            !schedule.isOpenNow &&
            schedule.message != null) ...[
          const SizedBox(height: 8),
          Text(schedule.message!),
        ],
        if (schedule.scheduleEnabled &&
            schedule.acceptingJoins &&
            schedule.todaySessions.isNotEmpty) ...[
          const SizedBox(height: 8),
          Text(
            "Today's hours: ${schedule.todaySessions.map((s) => s.label).join(', ')}",
            style: theme.textTheme.bodySmall,
          ),
        ],
      ],
    );
  }
}

/// Why this queue cannot be joined right now, in the customer's words — or
/// null when it can. Said before anyone picks a service or fills in a form;
/// the backend's own refusal at join time remains the authority.
String? joinBlockedNotice(QueueConfig config, {required bool needsIdentitySetup}) {
  // A queue that predates ADR-034 and still has no way to recognise a
  // customer refuses every join, so this says so here rather than after a
  // whole form is filled in.
  if (needsIdentitySetup) {
    return 'This queue is not accepting customers yet. Please contact staff.';
  }
  if (config.status != 'ACTIVE') {
    return 'This queue is not currently accepting new customers.';
  }
  // Phase 4: the backend already composes the specific reason (closed today
  // / opens at 09:00 / session full, etc.).
  if (config.schedule.scheduleEnabled && !config.schedule.acceptingJoins) {
    return config.schedule.message ?? 'This queue is not currently open.';
  }
  // Whatever else the queue's own answer rules out: never offer a join the
  // model says is closed just because no specific reason matched above.
  if (!config.isAcceptingCustomers) return 'This queue is not currently open.';
  return null;
}

/// Told before anyone fills anything in, so a limit is never a surprise at
/// the end of the flow. Says nothing about who has already visited (ADR-034).
///
/// ADR-049: reworded when the limit is per session — a customer served in
/// the morning must not read it as "you can never come back today".
String? repeatVisitNotice(QueueConfig config) {
  final notice = _queueWideRepeatNotice(config);
  if (notice == null || !config.identity.isPerSession) return notice;
  if (config.identity.restrictionType == 'ONCE_EVER') {
    return 'Each customer may be served once per session. You can still join a different session.';
  }
  return '$notice This limit applies per session — you can still join a different session.';
}

String? _queueWideRepeatNotice(QueueConfig config) {
  final identity = config.identity;
  switch (identity.restrictionType) {
    case 'ONCE_EVER':
      return 'Each customer may use this queue once.';
    case 'DURATION':
      final amount = identity.restrictionAmount;
      final unit = _unitLabel(identity.restrictionUnit, amount);
      if (amount == null || unit == null) return 'Repeat visits are limited.';
      return 'After being served, you can use this queue again in $amount $unit.';
    case 'UNTIL_DATETIME':
      final until = identity.restrictionUntil;
      if (until == null) return 'Repeat visits are limited.';
      // A shared cutoff is a single moment for everyone, so it is worth
      // naming the queue's clock when the customer is on a different one.
      final when = dualTime(until, timezoneName: config.timezone, dateAndTime: true);
      return when.differs
          ? 'One visit per customer until ${when.queue} (${when.timezoneName}).'
          : 'One visit per customer until ${when.local}.';
    default:
      return null;
  }
}

/// Singular or plural, so the sentence reads naturally.
String? _unitLabel(String? unit, int? amount) {
  const labels = {
    'MINUTE': ['minute', 'minutes'],
    'HOUR': ['hour', 'hours'],
    'DAY': ['day', 'days'],
    'WEEK': ['week', 'weeks'],
    'MONTH': ['month', 'months'],
    'YEAR': ['year', 'years'],
  };
  final pair = labels[unit];
  if (pair == null || amount == null) return null;
  return amount == 1 ? pair[0] : pair[1];
}

class _Notice extends StatelessWidget {
  const _Notice({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.orange.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(text, style: const TextStyle(color: Colors.orange)),
    );
  }
}
