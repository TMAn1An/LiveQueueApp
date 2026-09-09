import 'package:flutter/material.dart';

/// The one place a destructive mobile action asks "are you sure?" (V2
/// Product Completion checkpoint, Part B: any action that actually deletes,
/// clears, or permanently removes data must ask first).
///
/// Cancel is the default/safe action — it is what pressing outside the
/// dialog or the system back gesture does, matching [showDialog]'s own
/// barrier-dismissible default — and the destructive action is styled in
/// the theme's error colour so it reads as different from an ordinary
/// confirmation. Returns `true` only if the customer explicitly pressed the
/// destructive button; a dismissed dialog is `false`/no action, never null
/// treated as a green light.
Future<bool> showConfirmDialog(
  BuildContext context, {
  required String title,
  required String message,
  String confirmLabel = 'Delete',
  String cancelLabel = 'Cancel',
}) async {
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: Text(cancelLabel),
        ),
        TextButton(
          style: TextButton.styleFrom(foregroundColor: Theme.of(context).colorScheme.error),
          onPressed: () => Navigator.of(context).pop(true),
          child: Text(confirmLabel),
        ),
      ],
    ),
  );
  return confirmed ?? false;
}
