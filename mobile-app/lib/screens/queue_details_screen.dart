import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/queue_config.dart';
import '../repositories/queue_repository.dart';
import '../widgets/queue_join_summary.dart';

/// Everything a customer may want to know about the queue they are in:
/// what it is, whether it is open, today's hours, its repeat-visit rule and
/// the services it offers (ADR-063).
///
/// Opened from Live Tracking, once the customer holds a token. It used to be
/// a step between the QR scan and the service list; that step is gone, and
/// what it had to say before a join now heads the service list instead.
///
/// Always read fresh from the backend by queue id — a token can be reopened
/// days after the join that first loaded its queue, and a queue's status and
/// hours change. Read-only: nothing here starts or changes a join.
class QueueDetailsScreen extends StatefulWidget {
  const QueueDetailsScreen({super.key, required this.queueId});

  final String queueId;

  @override
  State<QueueDetailsScreen> createState() => _QueueDetailsScreenState();
}

class _QueueDetailsScreenState extends State<QueueDetailsScreen> {
  late Future<QueueConfig> _config;

  @override
  void initState() {
    super.initState();
    _config = _load();
  }

  Future<QueueConfig> _load() => context.read<QueueRepository>().getQueueConfig(widget.queueId);

  void _retry() {
    setState(() {
      _config = _load();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Queue Details')),
      body: FutureBuilder<QueueConfig>(
        future: _config,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          final config = snapshot.data;
          if (config == null) {
            return _LoadFailed(onRetry: _retry);
          }
          return _Details(config: config);
        },
      ),
    );
  }
}

class _Details extends StatelessWidget {
  const _Details({required this.config});

  final QueueConfig config;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        // The customer is already in this queue, so nothing here is about
        // whether *they* may join — a limit on repeat visits or a closed
        // queue is shown as a fact about the queue.
        QueueJoinSummary(
          config: config,
          needsIdentitySetup: config.identity.configurationRequired,
        ),
        const SizedBox(height: 16),
        const Divider(),
        _Row(label: 'Status', value: _statusLabel(config)),
        if (config.services.isNotEmpty) ...[
          const SizedBox(height: 16),
          Text('Services', style: theme.textTheme.titleMedium),
          const SizedBox(height: 4),
          for (final service in config.services)
            ListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              title: Text(service.serviceName),
              subtitle: service.description != null ? Text(service.description!) : null,
              trailing: Text('${service.durationMinutes} min'),
            ),
          Text(
            'One or several services can be chosen in one visit.',
            style: theme.textTheme.bodySmall,
          ),
        ],
      ],
    );
  }

  /// The queue's own status, in a word. Whether it is taking joins right now
  /// — a schedule can close an ACTIVE queue — is what "Open" means here.
  static String _statusLabel(QueueConfig config) {
    if (config.status == 'PAUSED') return 'Paused';
    if (config.status != 'ACTIVE') return 'Closed';
    return config.isAcceptingCustomers ? 'Open' : 'Closed for now';
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(context).textTheme.bodyLarge;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: style),
          Text(value, style: style?.copyWith(fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }
}

class _LoadFailed extends StatelessWidget {
  const _LoadFailed({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'Could not load this queue\'s details just now. Your token is not affected.',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            OutlinedButton(onPressed: onRetry, child: const Text('Try again')),
          ],
        ),
      ),
    );
  }
}
