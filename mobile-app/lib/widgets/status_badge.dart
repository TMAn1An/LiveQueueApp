import 'package:flutter/material.dart';

import '../models/live_queue_token.dart';
import '../theme/app_colors.dart';

class StatusBadge extends StatelessWidget {
  const StatusBadge({super.key, required this.status});

  final TokenStatus status;

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (status) {
      TokenStatus.waiting => ('Waiting', Colors.orange),
      TokenStatus.called => ('Your Turn', Colors.green),
      TokenStatus.inProgress => ('In Progress', AppColors.brandBlue),
      TokenStatus.completed => ('Completed', Colors.grey),
      TokenStatus.skipped => ('Skipped', Colors.red),
      TokenStatus.cancelled => ('Cancelled', Colors.deepOrange),
      TokenStatus.unknown => ('Unknown', Colors.grey),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(20)),
      child: Text(
        label,
        style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 16),
      ),
    );
  }
}
