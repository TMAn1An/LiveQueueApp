import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/live_queue_token.dart';
import '../providers/token_tracking_provider.dart';
import '../theme/app_colors.dart';
import '../widgets/connection_indicator.dart';
import '../widgets/status_badge.dart';
import 'home_screen.dart';

/// Spec section 7.17 "Mobile Live Tracking" — shows token number, status,
/// position, estimated wait, selected service, counter when called, plus
/// the queue paused/resumed notice and connection status (section 26).
class LiveTrackingScreen extends StatefulWidget {
  const LiveTrackingScreen({super.key});

  @override
  State<LiveTrackingScreen> createState() => _LiveTrackingScreenState();
}

class _LiveTrackingScreenState extends State<LiveTrackingScreen> {
  // Captured here rather than looked up fresh inside dispose(): by the time
  // dispose() runs the element may already be deactivated, and
  // context.read() at that point throws ("Looking up a deactivated widget's
  // ancestor is unsafe"). didChangeDependencies() runs while the widget is
  // still active, so this is the safe place to grab the reference.
  TokenTrackingProvider? _trackingProvider;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _trackingProvider = context.read<TokenTrackingProvider>();
  }

  @override
  void dispose() {
    _trackingProvider?.stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final tracking = context.watch<TokenTrackingProvider>();
    final token = tracking.token;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Live Tracking'),
        automaticallyImplyLeading: false,
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 16),
            child: Center(
              child: ConnectionIndicator(isConnected: tracking.isConnected, isResyncing: tracking.isResyncing),
            ),
          ),
        ],
      ),
      body: token == null
          ? const Center(child: Text('No token is being tracked.'))
          : SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (tracking.queuePausedNotice)
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(12),
                      margin: const EdgeInsets.only(bottom: 16),
                      decoration: BoxDecoration(
                        color: Colors.orange.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Text(
                        'This queue has been paused by staff.',
                        style: TextStyle(color: Colors.orange),
                      ),
                    ),
                  Center(
                    child: Column(
                      children: [
                        Text('Your Token', style: Theme.of(context).textTheme.titleMedium),
                        Text(
                          token.serialNumber,
                          style: Theme.of(context)
                              .textTheme
                              .displayMedium
                              ?.copyWith(fontWeight: FontWeight.bold),
                        ),
                        const SizedBox(height: 8),
                        StatusBadge(status: token.status),
                      ],
                    ),
                  ),
                  const SizedBox(height: 24),
                  if (token.status == TokenStatus.waiting) ...[
                    _InfoRow(label: 'Position', value: '${token.position ?? '-'}'),
                    if (token.estimatedReadyAt != null)
                      _CountdownRow(label: 'Estimated Wait', estimatedReadyAt: token.estimatedReadyAt!)
                    else
                      const _InfoRow(label: 'Estimated Wait', value: 'Not available'),
                  ],
                  if (token.status == TokenStatus.called && token.counter != null)
                    _InfoRow(label: 'Counter', value: token.counter!.name),
                  const SizedBox(height: 24),
                  if (token.status == TokenStatus.called)
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: Colors.green.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Text(
                        "It's your turn — please proceed.",
                        style: TextStyle(color: Colors.green, fontWeight: FontWeight.bold),
                        textAlign: TextAlign.center,
                      ),
                    ),
                  // V2 Checkpoint 7 (ADR-029): shown only while CALLED — the
                  // customer reads this code aloud to staff to start service.
                  if (token.status == TokenStatus.called) ...[
                    const SizedBox(height: 16),
                    const _VerificationCodeSection(),
                  ],
                  // V2 Checkpoint 7 (ADR-029): cancellation is only ever
                  // valid while WAITING or CALLED — the backend enforces
                  // this regardless, this just avoids offering a button that
                  // would always fail once service has started.
                  if (token.status == TokenStatus.waiting || token.status == TokenStatus.called) ...[
                    const SizedBox(height: 16),
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton(
                        onPressed: tracking.isCancelling ? null : () => _confirmCancel(context, tracking),
                        child: Text(tracking.isCancelling ? 'Cancelling…' : 'Leave Queue'),
                      ),
                    ),
                  ],
                  if (!token.isActive) ...[
                    Text(_terminalStatusMessage(token.status)),
                    const SizedBox(height: 16),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton(
                        onPressed: () {
                          Navigator.of(context).pushAndRemoveUntil(
                            MaterialPageRoute(builder: (_) => const HomeScreen()),
                            (route) => false,
                          );
                        },
                        child: const Text('Back to Home'),
                      ),
                    ),
                  ],
                ],
              ),
            ),
    );
  }

  String _terminalStatusMessage(TokenStatus status) {
    switch (status) {
      case TokenStatus.completed:
        return 'This token has been completed.';
      case TokenStatus.cancelled:
        return 'You cancelled this token.';
      case TokenStatus.skipped:
      case TokenStatus.waiting:
      case TokenStatus.called:
      case TokenStatus.inProgress:
      case TokenStatus.unknown:
        return 'This token was skipped.';
    }
  }

  Future<void> _confirmCancel(BuildContext context, TokenTrackingProvider tracking) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Leave this queue?'),
        content: const Text('You will lose your place in line. This cannot be undone.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: const Text('Never mind')),
          FilledButton(onPressed: () => Navigator.of(dialogContext).pop(true), child: const Text('Leave Queue')),
        ],
      ),
    );
    if (confirmed == true) {
      await tracking.cancelToken();
    }
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: Theme.of(context).textTheme.bodyLarge),
          Text(value, style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }
}

/// V2 Checkpoint 4 (ADR-026, Rule F): a locally-ticking countdown anchored to
/// a server-authoritative timestamp. Never computes its own estimate — it
/// only ever displays `now` counting down to `estimatedReadyAt`, which the
/// provider re-anchors (a brand new [estimatedReadyAt] value flows in as a
/// new `widget` on rebuild) whenever a fresh REST resync or
/// token.position_changed event arrives. No polling: this widget's own
/// [Timer] exists solely to repaint once a second, never to fetch anything.
class _CountdownRow extends StatefulWidget {
  const _CountdownRow({required this.label, required this.estimatedReadyAt});

  final String label;
  final DateTime estimatedReadyAt;

  @override
  State<_CountdownRow> createState() => _CountdownRowState();
}

class _CountdownRowState extends State<_CountdownRow> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) => setState(() {}));
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final remaining = widget.estimatedReadyAt.difference(DateTime.now());
    final clamped = remaining.isNegative ? Duration.zero : remaining;
    final minutes = clamped.inMinutes;
    final seconds = clamped.inSeconds % 60;
    final display = '$minutes:${seconds.toString().padLeft(2, '0')}';

    return _InfoRow(label: widget.label, value: display);
  }
}

/// V2 Checkpoint 7 (ADR-029): the customer-only service-start verification
/// code — large, easy to read aloud, never something the customer types
/// back into the app. Ticks locally (same pattern as [_CountdownRow]) purely
/// to detect its own expiry and swap to a "get a new code" prompt; it never
/// re-fetches on a timer, only on an explicit tap.
class _VerificationCodeSection extends StatefulWidget {
  const _VerificationCodeSection();

  @override
  State<_VerificationCodeSection> createState() => _VerificationCodeSectionState();
}

class _VerificationCodeSectionState extends State<_VerificationCodeSection> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) => setState(() {}));
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final tracking = context.watch<TokenTrackingProvider>();
    final code = tracking.verificationCode;
    final expiresAt = tracking.verificationCodeExpiresAt;
    final isExpired = expiresAt != null && !expiresAt.isAfter(DateTime.now());

    if (tracking.isLoadingVerificationCode && code == null) {
      return const Center(child: CircularProgressIndicator());
    }

    if (code == null || isExpired) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.grey.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Column(
          children: [
            const Text('Your verification code has expired.'),
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: tracking.isLoadingVerificationCode
                  ? null
                  : () => tracking.reissueVerificationCode(),
              child: const Text('Get a new code'),
            ),
          ],
        ),
      );
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.brandSurface,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        children: [
          Text('Verification Code', style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 4),
          Text(
            code,
            style: Theme.of(context)
                .textTheme
                .displaySmall
                ?.copyWith(fontWeight: FontWeight.bold, letterSpacing: 4),
          ),
          const SizedBox(height: 4),
          const Text(
            'Tell this code to the staff member to start your service.',
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}
