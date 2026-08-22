import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/queue_join_provider.dart';
import 'dynamic_form_screen.dart';

class ServiceSelectionScreen extends StatelessWidget {
  const ServiceSelectionScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<QueueJoinProvider>();
    final services = provider.queueConfig?.services ?? const [];

    return Scaffold(
      appBar: AppBar(title: const Text('Select a Service')),
      body: services.isEmpty
          ? const Center(child: Text('No services are currently available.'))
          : ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: services.length,
              separatorBuilder: (_, _) => const SizedBox(height: 8),
              itemBuilder: (context, index) {
                final service = services[index];
                return Card(
                  child: ListTile(
                    title: Text(service.serviceName),
                    subtitle: service.description != null ? Text(service.description!) : null,
                    trailing: Text('${service.durationMinutes} min'),
                    onTap: () {
                      context.read<QueueJoinProvider>().selectService(service);
                      Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => const DynamicFormScreen()),
                      );
                    },
                  ),
                );
              },
            ),
    );
  }
}
