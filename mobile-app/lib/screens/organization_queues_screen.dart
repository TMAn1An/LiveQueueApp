import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/organization_directory.dart';
import '../providers/queue_join_provider.dart';
import '../widgets/error_banner.dart';
import 'service_selection_screen.dart';

/// ADR-068: after scanning an organization's QR — its queues, how many
/// people are waiting in each and roughly how long, and which are closed
/// right now. Choosing a queue goes on to its services, exactly as a legacy
/// queue-only code does. What is listed, and whether a queue can be joined,
/// is the backend's decision; joining re-checks every rule regardless.
class OrganizationQueuesScreen extends StatelessWidget {
  const OrganizationQueuesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<QueueJoinProvider>();
    final organization = provider.organization;

    return Scaffold(
      appBar: AppBar(title: Text(organization?.name ?? 'Choose a queue')),
      body: organization == null
          ? Center(
              child: provider.isLoadingQueue
                  ? const CircularProgressIndicator()
                  : const Text('Organization not found.'),
            )
          : RefreshIndicator(
              onRefresh: () => provider.loadOrganization(organization.publicCode),
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(4, 0, 4, 12),
                    child: Text(
                      'Choose a queue',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                  ),
                  if (provider.errorMessage != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: ErrorBanner(message: provider.errorMessage!),
                    ),
                  if (organization.queues.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 24),
                      child: Center(child: Text('No queues are available here right now.')),
                    ),
                  for (final queue in organization.queues)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: _QueueCard(queue: queue),
                    ),
                ],
              ),
            ),
    );
  }
}

class _QueueCard extends StatelessWidget {
  const _QueueCard({required this.queue});

  final OrganizationQueueSummary queue;

  String get _waitingLine {
    final people = queue.waitingCount == 1 ? '1 person waiting' : '${queue.waitingCount} people waiting';
    final wait = queue.estimatedWaitMinutes;
    if (wait == null || queue.waitingCount == 0) return people;
    return '$people · about $wait min';
  }

  Future<void> _open(BuildContext context) async {
    final provider = context.read<QueueJoinProvider>();
    await provider.loadQueueById(queue.id);
    if (!context.mounted || provider.queueConfig == null) return;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => const ServiceSelectionScreen()),
    );
    // Back on the list: counts and opening state are refreshed, never
    // shown from the earlier look.
    final code = provider.organization?.publicCode;
    if (code != null && context.mounted) await provider.loadOrganization(code);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      margin: EdgeInsets.zero,
      child: ListTile(
        enabled: queue.isJoinable,
        title: Text(queue.name),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (queue.description != null) Text(queue.description!),
            Text(_waitingLine),
            if (!queue.isJoinable)
              Text(
                queue.message ?? 'Closed.',
                style: TextStyle(color: theme.colorScheme.error),
              ),
          ],
        ),
        trailing: queue.isJoinable ? const Icon(Icons.chevron_right) : null,
        onTap: queue.isJoinable ? () => _open(context) : null,
      ),
    );
  }
}
