import 'package:flutter/material.dart';

import '../models/history_entry.dart';
import '../models/live_queue_token.dart';
import '../utils/date_time_format.dart';

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
            _DetailRow(label: 'Created', value: formatLocalDateTime(entry.createdAt)),
            _DetailRow(label: 'Final Status', value: tokenStatusLabel(entry.finalStatus)),
            // ADR-042: staff's own words about how this visit ended, only
            // when there are some.
            if (entry.finalStatus == TokenStatus.skipped && entry.skipReason != null)
              _NoteRow(label: 'Reason', text: entry.skipReason!),
            if (entry.finalStatus == TokenStatus.completed && entry.completionFeedback != null)
              _NoteRow(label: 'Feedback', text: entry.completionFeedback!),
          ],
        ),
      ),
    );
  }
}

/// A free-text note can be long, so it gets its own lines rather than a
/// right-aligned value squeezed beside its label.
class _NoteRow extends StatelessWidget {
  const _NoteRow({required this.label, required this.text});
  final String label;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: Theme.of(context).textTheme.bodyMedium),
          const SizedBox(height: 4),
          Text(text, style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.bold)),
        ],
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
