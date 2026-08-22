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
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Colors.orange.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Text(
                        'This queue is not currently accepting new customers.',
                        style: TextStyle(color: Colors.orange),
                      ),
                    ),
                  const Spacer(),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: config.isAcceptingCustomers
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
