import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/active_token_summary.dart';
import '../models/history_entry.dart';
import '../providers/active_token_provider.dart';
import '../providers/history_provider.dart';
import '../providers/notification_preferences_provider.dart';
import '../providers/token_tracking_provider.dart';
import '../screens/live_tracking_screen.dart';
import '../screens/token_details_screen.dart';
import '../screens/token_history_screen.dart';

/// The one place that turns "the customer tapped a remembered token" into
/// "Live Tracking is open for that exact token" — shared by Home's rows, the
/// Active Tokens list, and (once wired) a Notification Center tap, so all
/// three behave identically rather than three near-copies drifting apart.
///
/// Always resyncs [tokenId] first. A locally remembered summary is only a
/// pointer — staff may have called, served, skipped or completed this
/// customer while the app was closed, and the backend is the only thing
/// that knows. Never uses any other token's state to decide this one's fate
/// (V2 Product Completion checkpoint, Part A/D: no global "current token").
///
/// SKIPPED is terminal (Recall was removed) exactly like COMPLETED/
/// CANCELLED — [ActiveTokenProvider.resyncOne] already removes it from the
/// active collection and returns null, so a skipped token always falls into
/// the "not active any more" branch below rather than opening Live Tracking.
Future<void> openActiveToken(BuildContext context, String tokenId) async {
  final activeTokenProvider = context.read<ActiveTokenProvider>();
  final messenger = ScaffoldMessenger.of(context);

  final token = await activeTokenProvider.resyncOne(tokenId);
  if (!context.mounted) return;

  if (token == null) {
    // A resync failure (network) and "this visit is genuinely over" both
    // come back as null — only the first still has a remembered summary to
    // retry against. The second case used to just tell the customer to go
    // look in History themselves; it now opens the right place directly.
    final stillRemembered = activeTokenProvider.summaryFor(tokenId) != null;
    if (stillRemembered) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not check this token just now. Please try again.')),
      );
      return;
    }
    await _openFinishedToken(context, tokenId);
    return;
  }

  final preferences = context.read<NotificationPreferencesProvider>().preferences;
  final queueName = activeTokenProvider.summaryFor(tokenId)?.queueName ?? '';
  context.read<TokenTrackingProvider>().start(token, preferences, queueName: queueName);
  Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LiveTrackingScreen()));
}

/// A token that is no longer active opens its own History details when the
/// entry can be found locally; otherwise the History list, so "View" always
/// lands somewhere useful instead of a toast telling the customer to go find
/// it themselves.
Future<void> _openFinishedToken(BuildContext context, String tokenId) async {
  final historyProvider = context.read<HistoryProvider>();
  if (historyProvider.entries.isEmpty && !historyProvider.isLoading) {
    await historyProvider.load();
    if (!context.mounted) return;
  }

  HistoryEntry? entry;
  for (final candidate in historyProvider.entries) {
    if (candidate.tokenId == tokenId) {
      entry = candidate;
      break;
    }
  }

  if (entry != null) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => TokenDetailsScreen(entry: entry!)));
    return;
  }
  Navigator.of(context).push(MaterialPageRoute(builder: (_) => const TokenHistoryScreen()));
}

/// Home-row label: "A002 · Pharmacy · Waiting" with only the parts that
/// exist, matching AppDrawer's existing join-non-empty-parts convention.
String activeTokenSummaryLabel(ActiveTokenSummary summary) {
  return [summary.serialNumber, summary.queueName].where((p) => p.isNotEmpty).join(' · ');
}
