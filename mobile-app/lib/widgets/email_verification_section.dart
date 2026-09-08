import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/queue_join_provider.dart';

/// Verifying the customer's email address before they join a queue that
/// recognises people that way (ADR-037).
///
/// Deliberately holds no notion of "verified" itself — it reflects the
/// provider, whose only evidence is a proof the server signed. The code is
/// typed here and sent straight on; it is never stored.
class EmailVerificationSection extends StatefulWidget {
  const EmailVerificationSection({super.key});

  @override
  State<EmailVerificationSection> createState() => _EmailVerificationSectionState();
}

class _EmailVerificationSectionState extends State<EmailVerificationSection> {
  final TextEditingController _codeController = TextEditingController();
  Timer? _cooldownTicker;

  @override
  void initState() {
    super.initState();
    // The Verify button turns on at the sixth digit, so the field has to
    // rebuild this widget as it is typed.
    _codeController.addListener(_onCodeChanged);
    // Drives the "resend in 45s" label, and only that — it rebuilds nothing
    // until a code has actually been sent.
    //
    // The condition is "a cooldown exists", not "time remains": stopping at
    // zero would skip the very frame that re-enables the Resend button,
    // leaving it stuck reading "Resend in 1s" for as long as the screen is
    // open. One cheap rebuild per second while a challenge is pending is the
    // right trade for a button that actually works.
    _cooldownTicker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      if (context.read<QueueJoinProvider>().resendAvailableAt != null) {
        setState(() {});
      }
    });
  }

  void _onCodeChanged() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _cooldownTicker?.cancel();
    _codeController.removeListener(_onCodeChanged);
    _codeController.dispose();
    super.dispose();
  }

  int _secondsUntilResend(DateTime? availableAt) {
    if (availableAt == null) return 0;
    final remaining = availableAt.difference(DateTime.now()).inSeconds;
    return remaining > 0 ? remaining : 0;
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<QueueJoinProvider>();
    final theme = Theme.of(context);
    final secondsLeft = _secondsUntilResend(provider.resendAvailableAt);

    if (provider.isEmailVerified) {
      return Card(
        margin: EdgeInsets.zero,
        child: ListTile(
          leading: Icon(Icons.verified_user, color: theme.colorScheme.primary),
          title: const Text('Email address verified'),
          subtitle: Text(provider.emailAddress),
          trailing: TextButton(
            // Not a "log out" — it just clears the proof so a different
            // address can be used, which the provider does on any edit.
            onPressed: () => context.read<QueueJoinProvider>().updateEmailAddress(''),
            child: const Text('Change'),
          ),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Verify your email address', style: theme.textTheme.titleMedium),
        const SizedBox(height: 4),
        Text(
          'This queue limits how often one customer may return, so it needs to '
          'know who you are. We will email you a code.',
          style: theme.textTheme.bodySmall,
        ),
        const SizedBox(height: 12),
        TextField(
          key: const Key('email-field'),
          keyboardType: TextInputType.emailAddress,
          enabled: !provider.isSendingCode,
          onChanged: (value) => context.read<QueueJoinProvider>().updateEmailAddress(value),
          decoration: const InputDecoration(
            labelText: 'Email address',
            // The backend normalizes what is typed; it never guesses at
            // provider-specific mailbox tricks, so neither does this hint.
            hintText: 'you@example.com',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 8),
        if (!provider.isAwaitingCode)
          SizedBox(
            width: double.infinity,
            child: OutlinedButton(
              key: const Key('send-code-button'),
              onPressed: provider.isSendingCode
                  ? null
                  : () => context.read<QueueJoinProvider>().sendVerificationCode(),
              child: Text(provider.isSendingCode ? 'Sending code…' : 'Send code'),
            ),
          ),
        if (provider.isAwaitingCode) ...[
          const SizedBox(height: 4),
          TextField(
            key: const Key('code-field'),
            controller: _codeController,
            keyboardType: TextInputType.number,
            maxLength: 6,
            enabled: !provider.isConfirmingCode,
            decoration: const InputDecoration(
              labelText: '6-digit code',
              border: OutlineInputBorder(),
              counterText: '',
            ),
          ),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              key: const Key('confirm-code-button'),
              onPressed: provider.isConfirmingCode || _codeController.text.trim().length < 6
                  ? null
                  : () => context
                      .read<QueueJoinProvider>()
                      .confirmVerificationCode(_codeController.text),
              child: Text(provider.isConfirmingCode ? 'Checking…' : 'Verify'),
            ),
          ),
          const SizedBox(height: 4),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              key: const Key('resend-code-button'),
              // The server enforces the cooldown regardless; disabling the
              // button just stops the customer spending an attempt on a
              // request that will be refused.
              onPressed: secondsLeft > 0 || provider.isSendingCode
                  ? null
                  : () => context.read<QueueJoinProvider>().sendVerificationCode(),
              child: Text(secondsLeft > 0 ? 'Resend in ${secondsLeft}s' : 'Resend code'),
            ),
          ),
        ],
        if (provider.verificationError != null)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              provider.verificationError!,
              style: TextStyle(color: theme.colorScheme.error),
            ),
          ),
      ],
    );
  }
}
