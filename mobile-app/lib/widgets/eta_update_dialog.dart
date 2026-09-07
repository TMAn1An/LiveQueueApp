import 'package:flutter/material.dart';

import '../models/eta_update_notice.dart';
import '../theme/app_colors.dart';
import '../utils/date_time_format.dart';

/// Shown when staff change how long a service is expected to take and that
/// moves this customer's estimated turn.
///
/// Brand blue, not red: a changed estimate is normal queue operation, not an
/// error or a failure — red stays reserved for things that actually went
/// wrong. Carries no serial number, queue name or staff identity, only the
/// new timing.
class EtaUpdateDialog extends StatelessWidget {
  const EtaUpdateDialog({super.key, required this.notice});

  final EtaUpdateNotice notice;

  @override
  Widget build(BuildContext context) {
    final readyAt = notice.estimatedReadyAt;
    final minutes = notice.estimatedWaitMinutes;

    return AlertDialog(
      title: Row(
        children: [
          const Icon(Icons.schedule, color: AppColors.brandBlue),
          const SizedBox(width: 8),
          const Expanded(child: Text('Estimated time updated')),
          // The explicit close control the requirement calls for — the
          // barrier and the system back gesture also dismiss this, but a
          // visible X is what a customer looks for.
          IconButton(
            icon: const Icon(Icons.close),
            tooltip: 'Close',
            onPressed: () => Navigator.of(context).pop(),
          ),
        ],
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Your estimated service time has changed.'),
          if (readyAt != null) ...[
            const SizedBox(height: 12),
            Text(
              'New expected time: ${formatLocalTime(readyAt)}',
              style: const TextStyle(fontWeight: FontWeight.bold, color: AppColors.brandText),
            ),
          ],
          if (minutes != null) ...[
            const SizedBox(height: 4),
            Text(
              'Approximately $minutes ${minutes == 1 ? 'minute' : 'minutes'} remaining.',
              style: const TextStyle(color: AppColors.brandBlueDark),
            ),
          ],
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('OK'),
        ),
      ],
    );
  }
}
