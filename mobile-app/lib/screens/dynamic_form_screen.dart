import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/queue_join_provider.dart';
import '../widgets/dynamic_form_field_widget.dart';
import '../widgets/error_banner.dart';
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
            if (fields.isEmpty)
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
              const SizedBox(height: 12),
            ],
            if (provider.errorMessage != null) ErrorBanner(message: provider.errorMessage!),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: provider.isSubmitting ? null : () => _submit(context),
                child: provider.isSubmitting
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
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
