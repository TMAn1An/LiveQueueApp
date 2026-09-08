import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/queue_join_provider.dart';
import '../widgets/dynamic_form_field_widget.dart';
import '../widgets/dual_time_row.dart';
import '../widgets/error_banner.dart';
import '../widgets/email_verification_section.dart';
import 'token_confirmation_screen.dart';

class DynamicFormScreen extends StatelessWidget {
  const DynamicFormScreen({super.key});

  Future<void> _submit(BuildContext context) async {
    final provider = context.read<QueueJoinProvider>();
    final success = await provider.submitJoin();
    if (!context.mounted) return;
    if (success) {
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => const TokenConfirmationScreen()),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<QueueJoinProvider>();
    final fields = [...(provider.queueConfig?.formFields ?? const [])]
      ..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));

    return Scaffold(
      appBar: AppBar(title: const Text('A Few Details')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (provider.requiresEmailVerification) ...[
              const EmailVerificationSection(),
              const SizedBox(height: 20),
              const Divider(),
              const SizedBox(height: 8),
            ],
            if (fields.isEmpty && !provider.requiresEmailVerification)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Text('No additional information is needed for this service.'),
              ),
            for (final field in fields) ...[
              DynamicFormFieldWidget(
                field: field,
                value: provider.formData[field.key],
                errorText: provider.formErrors[field.key],
                onChanged: (value) => context.read<QueueJoinProvider>().updateFormField(field.key, value),
              ),
              // Says why this one answer matters, so it is given accurately
              // — a mistyped identifier is what a repeat limit turns on.
              if (field.key == provider.identityFieldKey)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    'This queue uses your answer here to recognise you. Please enter it exactly as you would next time.',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
              const SizedBox(height: 12),
            ],
            if (provider.errorMessage != null) ...[
              ErrorBanner(message: provider.errorMessage!),
              // ADR-035: when a repeat limit turned them away, say exactly
              // when they may come back — on the queue's clock and on
              // theirs, so a customer abroad is not left guessing.
              if (provider.restrictionEndsAt != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: DualTimeRow(
                    label: 'You can join again after',
                    instant: provider.restrictionEndsAt!,
                    timezoneName: provider.queueConfig?.timezone,
                    dateAndTime: true,
                  ),
                ),
            ],
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: provider.isSubmitting || !provider.canSubmitJoin
                    ? null
                    : () => _submit(context),
                // Spinner *and* wording: the label alone leaves the customer
                // guessing whether the tap registered, and the spinner alone
                // does not say what is happening.
                child: provider.isSubmitting
                    ? const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                          ),
                          SizedBox(width: 10),
                          Text('Joining queue…'),
                        ],
                      )
                    : const Text('Join Queue'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
