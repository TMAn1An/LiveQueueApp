import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/active_token_summary.dart';
import '../providers/active_token_provider.dart';
import '../providers/notification_preferences_provider.dart';
import '../providers/token_tracking_provider.dart';
import '../screens/live_tracking_screen.dart';

/// The one place that turns "the customer tapped a remembered token" into
/// "Live Tracking is open for that exact token" — shared by Home's rows, the
/// Active Tokens list, and (once wired) a Notification Center tap, so all
/// three behave identically rather than three near-copies drifting apart.
///
/// Always resyncs [tokenId] first. A locally remembered summary is only a
/// pointer — staff may have called, served, skipped or recalled this
/// customer while the app was closed, and the backend is the only thing
/// that knows. Never uses any other token's state to decide this one's fate
/// (V2 Product Completion checkpoint, Part A/D: no global "current token").
Future<void> openActiveToken(BuildContext context, String tokenId) async {
  final activeTokenProvider = context.read<ActiveTokenProvider>();
  final messenger = ScaffoldMessenger.of(context);

  final token = await activeTokenProvider.resyncOne(tokenId);
  if (!context.mounted) return;

  if (token == null) {
    final stillRemembered = activeTokenProvider.summaryFor(tokenId) != null;
    messenger.showSnackBar(
      SnackBar(
        content: Text(
          stillRemembered
              ? 'Could not check this token just now. Please try again.'
              : 'That visit is finished. You can find it in History.',
        ),
      ),
    );
    return;
  }

  if (!token.isActive) {
    // SKIPPED: recoverable, but there is no live session to open until
    // staff recalls it — see isRecoverableTokenStatus.
    messenger.showSnackBar(
      const SnackBar(
        content: Text('This token was skipped. Staff can still recall it — check back later.'),
      ),
    );
    return;
  }

  final preferences = context.read<NotificationPreferencesProvider>().preferences;
  final queueName = activeTokenProvider.summaryFor(tokenId)?.queueName ?? '';
  context.read<TokenTrackingProvider>().start(token, preferences, queueName: queueName);
  Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LiveTrackingScreen()));
}

/// Home-row label: "A002 · Pharmacy · Waiting" with only the parts that
/// exist, matching AppDrawer's existing join-non-empty-parts convention.
String activeTokenSummaryLabel(ActiveTokenSummary summary) {
  return [summary.serialNumber, summary.queueName].where((p) => p.isNotEmpty).join(' · ');
}
