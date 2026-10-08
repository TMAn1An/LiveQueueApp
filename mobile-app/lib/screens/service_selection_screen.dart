import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/queue_config.dart';
import '../providers/queue_join_provider.dart';
import '../widgets/journey_builder.dart';
import '../widgets/queue_join_summary.dart';
import 'dynamic_form_screen.dart';

/// The first screen after a QR scan (ADR-063): which queue this is, anything
/// that decides whether the customer can join it, and the services to choose
/// from. Spec section 4.3's "customer sees queue details -> customer selects
/// service" happen here together rather than on two screens.
///
/// V2 Checkpoint 5 (ADR-027): checkbox-style multi-selection — several
/// services may be selected at once. The displayed total is UX only; the
/// backend recalculates and is authoritative (never trusts this number).
class ServiceSelectionScreen extends StatelessWidget {
  const ServiceSelectionScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<QueueJoinProvider>();
    final config = provider.queueConfig;

    return Scaffold(
      appBar: AppBar(title: const Text('Select Services')),
      body: config == null
          ? const Center(child: Text('Queue not found.'))
          : _QueueServices(provider: provider, config: config),
    );
  }
}

class _QueueServices extends StatelessWidget {
  const _QueueServices({required this.provider, required this.config});

  final QueueJoinProvider provider;
  final QueueConfig config;

  @override
  Widget build(BuildContext context) {
    final services = config.services;
    final selectedIds = provider.selectedServiceIds;

    // A queue that will refuse the join is said to be closed here, before
    // anyone picks a service or fills in a form — and offers neither. The
    // backend's own refusal at join time remains the authority.
    final canJoin =
        joinBlockedNotice(config, needsIdentitySetup: provider.queueNeedsIdentitySetup) == null;

    final list = ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(4, 4, 4, 16),
          child: QueueJoinSummary(
            config: config,
            needsIdentitySetup: provider.queueNeedsIdentitySetup,
          ),
        ),
        if (canJoin && services.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: Center(child: Text('No services are currently available.')),
          ),
        // ADR-070/071: every visit is an ordered journey of one or more
        // services; a stored allowMultipleServices=false is ignored.
        if (canJoin && services.isNotEmpty) JourneyBuilder(services: services),
      ],
    );

    return Column(
      children: [
        Expanded(child: list),
        if (canJoin && services.isNotEmpty)
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    'Estimated service time: ${provider.selectedTotalDurationMinutes} minutes',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                  const SizedBox(height: 12),
                  FilledButton(
                    onPressed: selectedIds.isEmpty || !provider.isJourneyValid
                        ? null
                        : () {
                            Navigator.of(context).push(
                              MaterialPageRoute(builder: (_) => const DynamicFormScreen()),
                            );
                          },
                    child: const Text('Next'),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}
