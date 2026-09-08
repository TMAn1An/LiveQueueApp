import 'package:flutter/material.dart';

import '../utils/app_config.dart';

/// Says, on the first screen the customer sees, that this build is pointed at
/// the local development backend.
///
/// It exists because the alternative is silence. `API_BASE_URL` defaults to
/// the Android emulator's host alias, which is unroutable from a real phone,
/// so a build that misses the `--dart-define` reaches nothing — and every
/// symptom of that shows up somewhere else: the scanner appears broken because
/// the queue lookup times out after the code is read, and the app appears slow
/// because the startup version check spends its whole budget before falling
/// back. Nothing on screen connects those to their single cause. This does.
///
/// Renders nothing at all in a correctly configured build, so it costs a
/// shipped app one boolean.
class DevBackendBanner extends StatelessWidget implements PreferredSizeWidget {
  const DevBackendBanner({super.key});

  static const double _height = 40;

  @override
  Size get preferredSize =>
      Size.fromHeight(AppConfig.usesLocalDevBackend ? _height : 0);

  @override
  Widget build(BuildContext context) {
    if (!AppConfig.usesLocalDevBackend) return const SizedBox.shrink();

    final theme = Theme.of(context);
    return Container(
      width: double.infinity,
      height: _height,
      color: theme.colorScheme.errorContainer,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        children: [
          Icon(
            Icons.warning_amber_rounded,
            size: 18,
            color: theme.colorScheme.onErrorContainer,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'Development build — talking to ${AppConfig.localDevBaseUrl}. '
              'Nothing will load on a real device.',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onErrorContainer,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
