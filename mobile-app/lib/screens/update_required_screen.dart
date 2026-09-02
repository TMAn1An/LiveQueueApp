import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/app_version_policy.dart';

/// V2 Checkpoint 9 (ADR-031): the blocking gate — shown instead of Home
/// whenever [AppVersionCompatibility.updateRequired] is true. No dismiss
/// action and no back-navigation escape (see [PopScope] below): the whole
/// point is that the rest of the app must not be reachable until the
/// customer updates.
class UpdateRequiredScreen extends StatelessWidget {
  const UpdateRequiredScreen({super.key, required this.compatibility});

  final AppVersionCompatibility compatibility;

  @override
  Widget build(BuildContext context) {
    final policy = compatibility.policy;
    final message = (policy != null && policy.message.isNotEmpty)
        ? policy.message
        : 'A new version of LiveQueue is required to continue.';

    return PopScope(
      canPop: false,
      child: Scaffold(
        body: SafeArea(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.system_update, size: 64, color: Colors.indigo),
                  const SizedBox(height: 16),
                  Text('Update Required', style: Theme.of(context).textTheme.headlineSmall),
                  const SizedBox(height: 12),
                  Text(message, textAlign: TextAlign.center),
                  const SizedBox(height: 8),
                  Text(
                    policy != null
                        ? 'Installed version: ${compatibility.installedVersion}  •  Required: ${policy.minimumVersion}'
                        : 'Installed version: ${compatibility.installedVersion}',
                    style: Theme.of(context).textTheme.bodySmall,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 24),
                  _UpdateButton(storeUrl: policy?.storeUrl ?? ''),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _UpdateButton extends StatefulWidget {
  const _UpdateButton({required this.storeUrl});

  final String storeUrl;

  @override
  State<_UpdateButton> createState() => _UpdateButtonState();
}

class _UpdateButtonState extends State<_UpdateButton> {
  String? _error;
  bool _launching = false;

  Future<void> _handleUpdate() async {
    setState(() {
      _error = null;
      _launching = true;
    });
    try {
      final uri = widget.storeUrl.isEmpty ? null : Uri.tryParse(widget.storeUrl);
      if (uri == null || !(await canLaunchUrl(uri))) {
        throw Exception('store url unavailable');
      }
      final launched = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!launched) {
        throw Exception('launch failed');
      }
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Could not open the update page. Please try again.');
      }
    } finally {
      if (mounted) {
        setState(() => _launching = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        SizedBox(
          width: double.infinity,
          child: FilledButton(
            onPressed: _launching ? null : _handleUpdate,
            child: Text(_launching ? 'Opening…' : 'Update App'),
          ),
        ),
        if (_error != null) ...[
          const SizedBox(height: 8),
          Text(
            _error!,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
            textAlign: TextAlign.center,
          ),
        ],
      ],
    );
  }
}
