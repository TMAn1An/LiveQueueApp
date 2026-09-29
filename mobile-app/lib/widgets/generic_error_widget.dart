import 'package:flutter/material.dart';

/// Last-resort fallback for an uncaught widget-build error anywhere in the
/// tree. Every expected failure already has its own safe, specific message
/// (ApiException/NetworkException mapping) — this exists only for the
/// unexpected case those never cover, so a genuine bug shows a plain
/// explanation instead of Flutter's default crash presentation (spec section
/// 25 — no negative result may be silent).
class GenericErrorWidget extends StatelessWidget {
  const GenericErrorWidget({super.key});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Theme.of(context).scaffoldBackgroundColor,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.error_outline, size: 40, color: Theme.of(context).colorScheme.error),
              const SizedBox(height: 12),
              const Text(
                'Something went wrong',
                style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              Text(
                'An unexpected error occurred. Restarting the app usually fixes this.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
