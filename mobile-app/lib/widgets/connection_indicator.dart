import 'package:flutter/material.dart';

import '../theme/app_colors.dart';

/// Spec section 26: "show connection status... do not show stale
/// information as current."
class ConnectionIndicator extends StatelessWidget {
  const ConnectionIndicator({super.key, required this.isConnected, this.isResyncing = false});

  final bool isConnected;
  final bool isResyncing;

  @override
  Widget build(BuildContext context) {
    final String label;
    final Color color;
    if (!isConnected) {
      label = 'Reconnecting…';
      color = Colors.orange;
    } else if (isResyncing) {
      label = 'Updating…';
      color = AppColors.brandBlue;
    } else {
      label = 'Live';
      color = Colors.green;
    }

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 6),
        Text(label, style: TextStyle(color: color, fontSize: 13)),
      ],
    );
  }
}
