import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:provider/provider.dart';

import '../models/service_option.dart';
import '../providers/queue_join_provider.dart';

/// ADR-070: the person arranges their services into an ordered journey
/// before joining. Steps are numbered automatically and can be reordered by
/// dragging the handle (touch or mouse), with the up/down buttons, or with
/// the screen reader's move actions. A service may repeat up to its limit,
/// never twice in a row. Once the token exists the order is fixed.
class JourneyBuilder extends StatelessWidget {
  const JourneyBuilder({super.key, required this.services});

  final List<ServiceOption> services;

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<QueueJoinProvider>();
    final steps = provider.journeySteps;
    final byId = {for (final s in services) s.id: s};
    final problems = provider.journeyProblemList.where((p) => p.code != 'JOURNEY_EMPTY').toList();
    final badSteps = {for (final p in problems) if (p.stepNumber != null) p.stepNumber!};
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Your services, in order', style: theme.textTheme.titleMedium),
        const SizedBox(height: 4),
        Text(
          'Add the services you need and arrange them in the order you want to be served. '
          'Drag a step by its handle, or use the arrows. Once you join, the order is fixed.',
          style: theme.textTheme.bodySmall,
        ),
        const SizedBox(height: 12),
        if (steps.isEmpty)
          Container(
            padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 12),
            decoration: BoxDecoration(
              border: Border.all(color: theme.dividerColor),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Text('No services yet. Add one below.', textAlign: TextAlign.center),
          )
        else
          ReorderableListView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            buildDefaultDragHandles: false,
            itemCount: steps.length,
            // Reports the step's final position (already adjusted for its
            // own removal).
            onReorderItem: (from, to) => context.read<QueueJoinProvider>().moveStep(from, to),
            itemBuilder: (context, index) {
              final service = byId[steps[index]];
              final name = service?.serviceName ?? 'Unavailable service';
              final invalid = badSteps.contains(index + 1);
              // Steps may repeat: "the 2nd Lab step" is a stable identity.
              final occurrence = steps.take(index).where((id) => id == steps[index]).length;
              return Card(
                key: ValueKey('${steps[index]}#$occurrence'),
                margin: const EdgeInsets.only(bottom: 8),
                shape: invalid
                    ? RoundedRectangleBorder(
                        side: BorderSide(color: theme.colorScheme.error, width: 1.5),
                        borderRadius: BorderRadius.circular(12),
                      )
                    : null,
                child: Semantics(
                  label: 'Step ${index + 1} of ${steps.length}: $name',
                  customSemanticsActions: {
                    if (index > 0)
                      const CustomSemanticsAction(label: 'Move up'): () =>
                          context.read<QueueJoinProvider>().moveStep(index, index - 1),
                    if (index < steps.length - 1)
                      const CustomSemanticsAction(label: 'Move down'): () =>
                          context.read<QueueJoinProvider>().moveStep(index, index + 1),
                  },
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                    child: Row(
                      children: [
                        ReorderableDragStartListener(
                          index: index,
                          child: const Padding(
                            padding: EdgeInsets.all(10),
                            child: Icon(Icons.drag_indicator, semanticLabel: 'Drag to reorder'),
                          ),
                        ),
                        CircleAvatar(
                          radius: 14,
                          backgroundColor: theme.colorScheme.primary,
                          child: Text(
                            '${index + 1}',
                            style: TextStyle(color: theme.colorScheme.onPrimary, fontWeight: FontWeight.bold),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(child: Text(name, style: theme.textTheme.bodyLarge)),
                        IconButton(
                          tooltip: 'Move $name up',
                          icon: const Icon(Icons.arrow_upward),
                          onPressed: index == 0
                              ? null
                              : () => context.read<QueueJoinProvider>().moveStep(index, index - 1),
                        ),
                        IconButton(
                          tooltip: 'Move $name down',
                          icon: const Icon(Icons.arrow_downward),
                          onPressed: index == steps.length - 1
                              ? null
                              : () => context.read<QueueJoinProvider>().moveStep(index, index + 1),
                        ),
                        IconButton(
                          tooltip: 'Remove step ${index + 1}, $name',
                          icon: const Icon(Icons.close),
                          onPressed: () => context.read<QueueJoinProvider>().removeStepAt(index),
                        ),
                      ],
                    ),
                  ),
                ),
              );
            },
          ),
        for (final problem in problems)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              problem.message,
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error),
            ),
          ),
        const SizedBox(height: 12),
        Text('Add a step', style: theme.textTheme.labelLarge),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final service in services)
              ActionChip(
                avatar: const Icon(Icons.add, size: 18),
                label: Text(_chipLabel(service, steps)),
                tooltip: 'Add ${service.serviceName}',
                onPressed: provider.canAddStep(service.id)
                    ? () => context.read<QueueJoinProvider>().addStep(service.id)
                    : null,
              ),
          ],
        ),
      ],
    );
  }

  static String _chipLabel(ServiceOption service, List<String> steps) {
    final used = steps.where((id) => id == service.id).length;
    return used == 0
        ? service.serviceName
        : '${service.serviceName} ($used/${service.maxOccurrencesPerJourney})';
  }
}
