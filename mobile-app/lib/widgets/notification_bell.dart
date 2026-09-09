import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/notification_center_provider.dart';
import '../screens/notification_center_screen.dart';

/// The app-bar entry point into the in-app Notification Center (V2 Product
/// Completion checkpoint, Part D). A small unread-count badge is the whole
/// reason this exists rather than just a drawer item: it is what lets a
/// customer see, without opening anything, that something happened while
/// they weren't looking.
class NotificationBell extends StatelessWidget {
  const NotificationBell({super.key});

  @override
  Widget build(BuildContext context) {
    final unread = context.watch<NotificationCenterProvider>().unreadCount;

    return Stack(
      clipBehavior: Clip.none,
      children: [
        IconButton(
          icon: const Icon(Icons.notifications_outlined),
          tooltip: 'Notifications',
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => const NotificationCenterScreen()),
          ),
        ),
        if (unread > 0)
          Positioned(
            right: 6,
            top: 6,
            child: IgnorePointer(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                constraints: const BoxConstraints(minWidth: 16, minHeight: 16),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.error,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  unread > 9 ? '9+' : '$unread',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white, fontSize: 10, height: 1.2),
                ),
              ),
            ),
          ),
      ],
    );
  }
}
