import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/live_queue_token.dart';
import '../providers/token_tracking_provider.dart';
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
                    _InfoRow(
                      label: 'Estimated Wait',
                      value: token.estimatedWaitMinutes != null
                          ? '${token.estimatedWaitMinutes} minutes'
                          : 'Not available',
                    ),
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
                  if (!token.isActive) ...[
                    Text(
                      token.status == TokenStatus.completed
                          ? 'This token has been completed.'
                          : 'This token was skipped.',
                    ),
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
