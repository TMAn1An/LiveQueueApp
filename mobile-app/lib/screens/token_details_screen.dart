import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../models/history_entry.dart';

class TokenDetailsScreen extends StatelessWidget {
  const TokenDetailsScreen({super.key, required this.entry});

  final HistoryEntry entry;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(entry.serialNumber)),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _DetailRow(label: 'Queue', value: entry.queueName),
            _DetailRow(label: 'Service', value: entry.serviceName),
            _DetailRow(label: 'Created', value: DateFormat.yMMMd().add_jm().format(entry.createdAt)),
            _DetailRow(label: 'Final Status', value: entry.finalStatus.name),
          ],
        ),
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: Theme.of(context).textTheme.bodyMedium),
          Text(value, style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }
}
