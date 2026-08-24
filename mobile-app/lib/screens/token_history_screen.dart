import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../models/history_entry.dart';
import '../models/live_queue_token.dart';
import '../providers/history_provider.dart';
import '../providers/notification_preferences_provider.dart';
import '../providers/token_tracking_provider.dart';
import '../repositories/token_repository.dart';
import 'live_tracking_screen.dart';
import 'token_details_screen.dart';

/// Spec section 7.20: token number, organization, queue, service, created
/// time, final status — device-local only (see HistoryStorageService).
///
/// An entry whose recorded status is still active (waiting/called/
/// in-progress — never actually "final" yet, just whatever was last
/// recorded at creation time) resumes live tracking instead of opening the
/// static details screen: this is the only way back into Live Tracking once
/// you've left it other than tapping a status-change notification, since
/// Home has no "resume my active token" entry point of its own.
class TokenHistoryScreen extends StatefulWidget {
  const TokenHistoryScreen({super.key});

  @override
  State<TokenHistoryScreen> createState() => _TokenHistoryScreenState();
}

class _TokenHistoryScreenState extends State<TokenHistoryScreen> {
  bool _resuming = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => context.read<HistoryProvider>().load());
  }

  Future<void> _openEntry(HistoryEntry entry) async {
    if (!isActiveTokenStatus(entry.finalStatus)) {
      Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => TokenDetailsScreen(entry: entry)),
      );
      return;
    }

    setState(() => _resuming = true);
    try {
      final tokenRepository = context.read<TokenRepository>();
      final trackingProvider = context.read<TokenTrackingProvider>();
      final preferences = context.read<NotificationPreferencesProvider>().preferences;

      final freshToken = await tokenRepository.getToken(entry.tokenId);
      trackingProvider.start(freshToken, preferences);
      if (!mounted) return;
      Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => const LiveTrackingScreen()),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not load this token right now. Please try again.')),
      );
    } finally {
      if (mounted) setState(() => _resuming = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<HistoryProvider>();

    return Scaffold(
      appBar: AppBar(title: const Text('Token History')),
      body: Stack(
        children: [
          provider.isLoading
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
                          onTap: _resuming ? null : () => _openEntry(entry),
                        );
                      },
                    ),
          if (_resuming)
            Container(
              color: Colors.black.withValues(alpha: 0.1),
              child: const Center(child: CircularProgressIndicator()),
            ),
        ],
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
