import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/app_notification.dart';
import '../providers/notification_center_provider.dart';
import '../utils/open_active_token.dart';

/// The in-app Notification Center (V2 Product Completion checkpoint, Part
/// D) — recent queue events for this installation, independent of whatever
/// Android push notifications arrived, were dismissed, or never delivered
/// at all.
class NotificationCenterScreen extends StatelessWidget {
  const NotificationCenterScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<NotificationCenterProvider>();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          if (provider.unreadCount > 0)
            TextButton(
              onPressed: () => context.read<NotificationCenterProvider>().markAllRead(),
              child: const Text('Mark all read', style: TextStyle(color: Colors.white)),
            ),
        ],
      ),
      body: provider.isLoading
          ? const Center(child: CircularProgressIndicator())
          : provider.notifications.isEmpty
              ? const _EmptyState()
              : ListView.separated(
                  itemCount: provider.notifications.length,
                  separatorBuilder: (_, _) => const Divider(height: 1),
                  itemBuilder: (context, index) =>
                      _NotificationTile(notification: provider.notifications[index]),
                ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.notifications_none, size: 64),
            const SizedBox(height: 16),
            Text(
              'Nothing yet. Notifications about your tokens will appear here.',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ],
        ),
      ),
    );
  }
}

class _NotificationTile extends StatelessWidget {
  const _NotificationTile({required this.notification});
  final AppNotification notification;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return ListTile(
      leading: Icon(
        _iconFor(notification.kind),
        color: notification.read ? theme.colorScheme.outline : theme.colorScheme.primary,
      ),
      title: Text(
        notification.title,
        style: TextStyle(fontWeight: notification.read ? FontWeight.normal : FontWeight.bold),
      ),
      subtitle: Text('${notification.body} · ${_relativeTime(notification.createdAt)}'),
      trailing: notification.read
          ? null
          : Icon(Icons.circle, size: 10, color: theme.colorScheme.primary),
      onTap: () {
        context.read<NotificationCenterProvider>().markRead(notification.id);
        // Never a global "current token" — this notification names exactly
        // which token it is about, and that is the one that opens.
        openActiveToken(context, notification.tokenId);
      },
    );
  }

  IconData _iconFor(NotificationKind kind) {
    return switch (kind) {
      NotificationKind.joined => Icons.qr_code_scanner,
      NotificationKind.statusChanged => Icons.confirmation_number,
      NotificationKind.etaChanged => Icons.schedule,
      NotificationKind.reminder => Icons.notifications_active,
    };
  }
}

/// A short, coarse "N min/hours/days ago" — good enough for a recent-activity
/// feed; exact times are already available on the token's own details.
String _relativeTime(DateTime when) {
  final diff = DateTime.now().difference(when);
  if (diff.inMinutes < 1) return 'just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes} min ago';
  if (diff.inHours < 24) return '${diff.inHours} hr ago';
  return '${diff.inDays} d ago';
}
