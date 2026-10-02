import 'package:flutter/material.dart';

/// The caution shown when a customer's turn is already closer than their
/// reminder time (ADR-062) — the reminder cannot give that much notice, and
/// saying so beats letting them wait for an alert that will not come early.
class ReminderCaution extends StatelessWidget {
  const ReminderCaution({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    // Amber on a pale wash, with the text in the ordinary on-surface colour:
    // the icon carries the warning, the words stay fully legible.
    const accent = Color(0xFFB45309);
    return Semantics(
      container: true,
      liveRegion: true,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: accent.withValues(alpha: 0.10),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: accent.withValues(alpha: 0.35)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(Icons.warning_amber_rounded, color: accent, size: 20),
            const SizedBox(width: 8),
            Expanded(child: Text(message, style: theme.textTheme.bodyMedium)),
          ],
        ),
      ),
    );
  }
}
