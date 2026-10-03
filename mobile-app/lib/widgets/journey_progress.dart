import 'package:flutter/material.dart';

import '../models/token_journey.dart';

/// ADR-070: the person's steps after joining — current and next step, what
/// is done, and any referral. Read-only: there is nothing to change here.
class JourneyProgress extends StatelessWidget {
  const JourneyProgress({super.key, required this.journey});

  final TokenJourney journey;

  static const _statusText = {
    'PENDING': 'Waiting',
    'CALLED': 'Called',
    'IN_PROGRESS': 'Being served',
    'COMPLETED': 'Done',
    'SKIPPED': 'Skipped',
    'CANCELLED': 'Cancelled',
  };

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final current = journey.current;
    final next = journey.next;
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Step ${journey.currentStepNumber} of ${journey.totalSteps}'
              '${current != null ? ' · ${current.serviceName}' : ''}',
              style: theme.textTheme.titleMedium,
            ),
            if (next != null) ...[
              const SizedBox(height: 2),
              Text('Next: ${next.serviceName}', style: theme.textTheme.bodySmall),
            ],
            if (journey.referredToCounterName != null) ...[
              const SizedBox(height: 8),
              Text(
                'You have been referred to ${journey.referredToCounterName} for this step.',
                style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.primary),
              ),
            ],
            const SizedBox(height: 12),
            for (final step in journey.steps)
              Semantics(
                selected: step.stepNumber == journey.currentStepNumber,
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(
                    children: [
                      CircleAvatar(
                        radius: 12,
                        backgroundColor: step.isDone
                            ? Colors.green.shade600
                            : step.stepNumber == journey.currentStepNumber
                                ? theme.colorScheme.primary
                                : theme.colorScheme.surfaceContainerHighest,
                        child: step.isDone
                            ? const Icon(Icons.check, size: 14, color: Colors.white)
                            : Text(
                                '${step.stepNumber}',
                                style: TextStyle(
                                  fontSize: 12,
                                  color: step.stepNumber == journey.currentStepNumber
                                      ? theme.colorScheme.onPrimary
                                      : theme.colorScheme.onSurface,
                                ),
                              ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(child: Text(step.serviceName)),
                      Text(
                        '${_statusText[step.status] ?? step.status}'
                        '${step.counterName != null && step.status != 'PENDING' ? ' · ${step.counterName}' : ''}',
                        style: theme.textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
