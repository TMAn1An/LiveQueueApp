import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../models/history_entry.dart';
import '../providers/history_provider.dart';
import 'token_details_screen.dart';

/// Spec section 7.20: token number, organization, queue, service, created
/// time, final status — device-local only (see HistoryStorageService).
class TokenHistoryScreen extends StatefulWidget {
  const TokenHistoryScreen({super.key});

  @override
  State<TokenHistoryScreen> createState() => _TokenHistoryScreenState();
}

class _TokenHistoryScreenState extends State<TokenHistoryScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => context.read<HistoryProvider>().load());
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<HistoryProvider>();

    return Scaffold(
      appBar: AppBar(title: const Text('Token History')),
      body: provider.isLoading
          ? const Center(child: CircularProgressIndicator())
          : provider.entries.isEmpty
              ? const Center(child: Text('No previous tokens yet.'))
              : ListView.separated(
                  itemCount: provider.entries.length,
                  separatorBuilder: (_, _) => const Divider(height: 1),
                  itemBuilder: (context, index) {
                    final entry = provider.entries[index];
                    return ListTile(
                      title: Text('${entry.serialNumber} — ${entry.queueName}'),
                      subtitle: Text(
                        '${entry.serviceName} · ${DateFormat.yMMMd().add_jm().format(entry.createdAt)}',
                      ),
                      trailing: _FinalStatusLabel(entry: entry),
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => TokenDetailsScreen(entry: entry)),
                      ),
                    );
                  },
                ),
    );
  }
}

class _FinalStatusLabel extends StatelessWidget {
  const _FinalStatusLabel({required this.entry});
  final HistoryEntry entry;

  @override
  Widget build(BuildContext context) {
    final label = switch (entry.finalStatus.name) {
      'completed' => 'Completed',
      'skipped' => 'Skipped',
      'waiting' => 'Waiting',
      'called' => 'Called',
      'inProgress' => 'In Progress',
      _ => 'Unknown',
    };
    return Text(label, style: Theme.of(context).textTheme.bodySmall);
  }
}
