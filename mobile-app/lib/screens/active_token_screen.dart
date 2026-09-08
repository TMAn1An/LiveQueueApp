import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/live_queue_token.dart';
import '../providers/active_token_provider.dart';
import '../providers/notification_preferences_provider.dart';
import '../providers/token_tracking_provider.dart';
import '../widgets/app_drawer.dart';
import 'live_tracking_screen.dart';

/// The way back to a token that is still in a queue (ADR-036).
///
/// Always resyncs before showing anything. A locally remembered token is
/// only a pointer — staff may have called, served or skipped this customer
/// while the app was closed, and the backend is the only thing that knows.
/// Once confirmed still active, it hands off to the existing live tracking
/// screen, which owns the socket session as it always has.
class ActiveTokenScreen extends StatefulWidget {
  const ActiveTokenScreen({super.key});

  @override
  State<ActiveTokenScreen> createState() => _ActiveTokenScreenState();
}

class _ActiveTokenScreenState extends State<ActiveTokenScreen> {
  bool _loading = true;
  LiveQueueToken? _token;
  String? _message;

  @override
  void initState() {
    super.initState();
    // Deferred one frame so the first build can show the loading state
    // rather than the screen appearing already-populated or already-empty.
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    final active = context.read<ActiveTokenProvider>();
    if (!active.hasActiveToken) {
      setState(() {
        _loading = false;
        _token = null;
        _message = 'You are not currently in a queue.';
      });
      return;
    }

    final token = await active.resync();
    if (!mounted) return;
    setState(() {
      _loading = false;
      _token = token;
      _message = token == null
          // Either the visit finished while the app was away — in which case
          // it is in History now — or the server could not be reached, and
          // the pointer was deliberately kept.
          ? active.hasActiveToken
              ? 'Could not check your token just now. Please try again.'
              : 'Your last visit is finished. You can find it in History.'
          : null;
    });
  }

  void _openTracking(LiveQueueToken token) {
    final preferences = context.read<NotificationPreferencesProvider>().preferences;
    context.read<TokenTrackingProvider>().start(token, preferences);
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const LiveTrackingScreen()),
    );
  }

  @override
  Widget build(BuildContext context) {
    final token = _token;

    return Scaffold(
      appBar: AppBar(title: const Text('Active Token')),
      drawer: const AppDrawer(),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: _loading
              ? const Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    CircularProgressIndicator(),
                    SizedBox(height: 16),
                    Text('Checking your token…'),
                  ],
                )
              : token == null
                  ? Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.inbox_outlined, size: 64),
                        const SizedBox(height: 16),
                        Text(_message ?? '', textAlign: TextAlign.center),
                        const SizedBox(height: 20),
                        OutlinedButton(onPressed: _load, child: const Text('Check again')),
                      ],
                    )
                  : Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          token.serialNumber,
                          style: Theme.of(context).textTheme.displaySmall,
                        ),
                        const SizedBox(height: 8),
                        Text('You are still in this queue.'),
                        const SizedBox(height: 24),
                        SizedBox(
                          width: double.infinity,
                          child: FilledButton(
                            onPressed: () => _openTracking(token),
                            child: const Text('Open live tracking'),
                          ),
                        ),
                      ],
                    ),
        ),
      ),
    );
  }
}
