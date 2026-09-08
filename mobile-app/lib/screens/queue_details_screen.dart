import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/queue_join_provider.dart';
import 'service_selection_screen.dart';

/// Spec section 4.3: "Customer sees queue details -> Customer selects
/// service." Also spec 33: avoid unnecessary forms/animations here.
class QueueDetailsScreen extends StatelessWidget {
  const QueueDetailsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<QueueJoinProvider>();
    final config = provider.queueConfig;

    return Scaffold(
      appBar: AppBar(title: const Text('Queue Details')),
      body: config == null
          ? const Center(child: Text('Queue not found.'))
          : Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(config.name, style: Theme.of(context).textTheme.headlineSmall),
                  if (config.description != null) ...[
                    const SizedBox(height: 8),
                    Text(config.description!),
                  ],
                  const SizedBox(height: 16),
                  if (!config.isAcceptingCustomers)
                    _Notice(
                      // A queue that predates ADR-034 and still has no way to
                      // recognise a customer refuses every join, so this says
                      // so here rather than after a whole form is filled in.
                      text: provider.queueNeedsIdentitySetup
                          ? 'This queue is not accepting customers yet. Please contact staff.'
                          : 'This queue is not currently accepting new customers.',
                    )
                  else if (provider.queueNeedsIdentitySetup)
                    const _Notice(
                      text: 'This queue is not accepting customers yet. Please contact staff.',
                    )
                  else if (_repeatNotice(config.identity.restrictionPeriod) != null)
                    _Notice(text: _repeatNotice(config.identity.restrictionPeriod)!),
                  const Spacer(),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: config.isAcceptingCustomers &&
                              !provider.queueNeedsIdentitySetup
                          ? () => Navigator.of(context).push(
                                MaterialPageRoute(builder: (_) => const ServiceSelectionScreen()),
                              )
                          : null,
                      child: const Text('Continue'),
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}

/// Told before anyone fills anything in, so a limit is never a surprise at
/// the end of the flow. Says nothing about who has already visited (ADR-034).
String? _repeatNotice(String? restrictionPeriod) {
  switch (restrictionPeriod) {
    case 'ONCE_EVER':
      return 'Each customer may use this queue once.';
    case 'DAILY':
      return 'Each customer may use this queue once per day.';
    case 'WEEKLY':
      return 'Each customer may use this queue once per week.';
    case 'MONTHLY':
      return 'Each customer may use this queue once per month.';
    default:
      return null;
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.orange.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(text, style: const TextStyle(color: Colors.orange)),
    );
  }
}
