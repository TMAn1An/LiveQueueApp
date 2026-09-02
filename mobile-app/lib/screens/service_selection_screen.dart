import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/queue_join_provider.dart';
import 'dynamic_form_screen.dart';

/// V2 Checkpoint 5 (ADR-027): checkbox-style multi-selection — several
/// services may be selected at once. The displayed total is UX only; the
/// backend recalculates and is authoritative (never trusts this number).
class ServiceSelectionScreen extends StatelessWidget {
  const ServiceSelectionScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<QueueJoinProvider>();
    final services = provider.queueConfig?.services ?? const [];
    final selectedIds = provider.selectedServiceIds;
    final allowMultiple = provider.queueConfig?.allowMultipleServices ?? true;

    Widget serviceList() {
      return ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: services.length,
        separatorBuilder: (_, _) => const SizedBox(height: 8),
        itemBuilder: (context, index) {
          final service = services[index];
          final selected = selectedIds.contains(service.id);
          return Card(
            child: allowMultiple
                ? CheckboxListTile(
                    value: selected,
                    onChanged: (_) => context.read<QueueJoinProvider>().toggleService(service.id),
                    title: Text(service.serviceName),
                    subtitle: service.description != null ? Text(service.description!) : null,
                    secondary: Text('${service.durationMinutes} min'),
                  )
                : RadioListTile<String>(
                    value: service.id,
                    title: Text(service.serviceName),
                    subtitle: service.description != null ? Text(service.description!) : null,
                    secondary: Text('${service.durationMinutes} min'),
                  ),
          );
        },
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Select Services')),
      body: services.isEmpty
          ? const Center(child: Text('No services are currently available.'))
          : Column(
              children: [
                Expanded(
                  // V2 Checkpoint 6: single-select queues wrap the same list in
                  // a RadioGroup — selecting one service replaces the whole
                  // selection (toggleService already implements that swap for
                  // this queue's mode); multi-select queues render unwrapped,
                  // unchanged checkbox behavior.
                  child: allowMultiple
                      ? serviceList()
                      : RadioGroup<String>(
                          groupValue: selectedIds.isEmpty ? null : selectedIds.first,
                          onChanged: (value) {
                            if (value != null) {
                              context.read<QueueJoinProvider>().toggleService(value);
                            }
                          },
                          child: serviceList(),
                        ),
                ),
                SafeArea(
                  top: false,
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          'Estimated service time: ${provider.selectedTotalDurationMinutes} minutes',
                          textAlign: TextAlign.center,
                          style: Theme.of(context).textTheme.bodyMedium,
                        ),
                        const SizedBox(height: 12),
                        FilledButton(
                          onPressed: selectedIds.isEmpty
                              ? null
                              : () {
                                  Navigator.of(context).push(
                                    MaterialPageRoute(builder: (_) => const DynamicFormScreen()),
                                  );
                                },
                          child: const Text('Next'),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}
