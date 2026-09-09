import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/active_token_summary.dart';
import '../models/live_queue_token.dart';
import '../providers/active_token_provider.dart';
import '../utils/open_active_token.dart';
import '../widgets/app_drawer.dart';

/// Every token this installation is currently in a queue with (ADR-036,
/// extended by the V2 Product Completion checkpoint from a single token to
/// a collection). A skipped token is terminal and is removed from this
/// collection, not shown here.
///
/// Always resyncs every remembered token before showing anything as
/// current: a locally remembered summary is only a pointer — staff may have
/// called, served, skipped or completed any of these customers while the app
/// was closed, and the backend is the only thing that knows. One token's
/// resync failing (network, a stale 404) never blocks the others from
/// showing correctly — see [ActiveTokenProvider.resyncAll].
class ActiveTokensScreen extends StatefulWidget {
  const ActiveTokensScreen({super.key});

  @override
  State<ActiveTokensScreen> createState() => _ActiveTokensScreenState();
}

class _ActiveTokensScreenState extends State<ActiveTokensScreen> {
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    // Deferred one frame so the first build can show the loading state
    // rather than the screen appearing already-populated or already-empty.
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    final provider = context.read<ActiveTokenProvider>();
    if (!provider.hasActiveToken) {
      setState(() => _loading = false);
      return;
    }

    try {
      await provider.resyncAll();
    } catch (_) {
      // resyncAll/resyncOne never throw in practice, but the fallback keeps
      // this screen from wedging on loading if that ever changes.
    }
    if (!mounted) return;
    setState(() => _loading = false);
  }

  @override
  Widget build(BuildContext context) {
    final tokens = context.watch<ActiveTokenProvider>().activeTokens;

    return Scaffold(
      appBar: AppBar(title: const Text('Active Tokens')),
      drawer: const AppDrawer(),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : tokens.isEmpty
              ? _EmptyState(onRetry: () {
                  setState(() => _loading = true);
                  _load();
                })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: tokens.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 8),
                    itemBuilder: (context, index) => _ActiveTokenCard(summary: tokens[index]),
                  ),
                ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.onRetry});
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.inbox_outlined, size: 64),
            const SizedBox(height: 16),
            // Either every visit finished while the app was away — in which
            // case they are all in History now — or none was ever remembered.
            const Text('You are not currently in any queue.', textAlign: TextAlign.center),
            const SizedBox(height: 20),
            OutlinedButton(onPressed: onRetry, child: const Text('Check again')),
          ],
        ),
      ),
    );
  }
}

class _ActiveTokenCard extends StatelessWidget {
  const _ActiveTokenCard({required this.summary});
  final ActiveTokenSummary summary;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final skipped = summary.status == TokenStatus.skipped;

    return Card(
      margin: EdgeInsets.zero,
      child: ListTile(
        leading: Icon(
          Icons.confirmation_number,
          color: skipped ? theme.colorScheme.outline : theme.colorScheme.primary,
        ),
        title: Text(summary.serialNumber, style: theme.textTheme.titleMedium),
        subtitle: Text(
          [summary.queueName, tokenStatusLabel(summary.status)]
              .where((p) => p.isNotEmpty)
              .join(' · '),
        ),
        trailing: const Icon(Icons.chevron_right),
        onTap: () => openActiveToken(context, summary.tokenId),
      ),
    );
  }
}
