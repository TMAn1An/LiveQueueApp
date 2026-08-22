import 'package:flutter/material.dart';

import '../models/dynamic_form_field.dart';

/// Renders one dynamic form field per its backend-defined type. Purely
/// presentational — validation and state live in QueueJoinProvider
/// (CLAUDE.md: keep business logic outside UI widgets).
class DynamicFormFieldWidget extends StatelessWidget {
  const DynamicFormFieldWidget({
    super.key,
    required this.field,
    required this.value,
    required this.errorText,
    required this.onChanged,
  });

  final DynamicFormField field;
  final dynamic value;
  final String? errorText;
  final ValueChanged<dynamic> onChanged;

  String get _labelWithRequiredMarker => field.required ? '${field.label} *' : field.label;

  @override
  Widget build(BuildContext context) {
    switch (field.type) {
      case DynamicFieldType.dropdown:
        return DropdownButtonFormField<String>(
          key: ValueKey(field.key),
          initialValue: (value as String?)?.isEmpty ?? true ? null : value as String,
          decoration: InputDecoration(labelText: _labelWithRequiredMarker, errorText: errorText),
          items: field.options
              .map((option) => DropdownMenuItem(value: option, child: Text(option)))
              .toList(),
          onChanged: (v) => onChanged(v ?? ''),
        );

      case DynamicFieldType.radio:
        return RadioGroup<String>(
          groupValue: value as String?,
          onChanged: (v) => onChanged(v ?? ''),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(_labelWithRequiredMarker, style: Theme.of(context).textTheme.bodyMedium),
              ...field.options.map(
                (option) => RadioListTile<String>(
                  title: Text(option),
                  value: option,
                  contentPadding: EdgeInsets.zero,
                ),
              ),
              if (errorText != null)
                Padding(
                  padding: const EdgeInsets.only(left: 12),
                  child: Text(
                    errorText!,
                    style: TextStyle(color: Theme.of(context).colorScheme.error, fontSize: 12),
                  ),
                ),
            ],
          ),
        );

      case DynamicFieldType.checkbox:
        return CheckboxListTile(
          title: Text(_labelWithRequiredMarker),
          value: value as bool? ?? false,
          onChanged: (v) => onChanged(v ?? false),
          contentPadding: EdgeInsets.zero,
          controlAffinity: ListTileControlAffinity.leading,
        );

      case DynamicFieldType.number:
        return TextFormField(
          key: ValueKey(field.key),
          initialValue: value?.toString(),
          keyboardType: TextInputType.number,
          decoration: InputDecoration(
            labelText: _labelWithRequiredMarker,
            hintText: field.placeholder,
            errorText: errorText,
          ),
          onChanged: (v) => onChanged(num.tryParse(v)),
        );

      case DynamicFieldType.email:
        return TextFormField(
          key: ValueKey(field.key),
          initialValue: value as String?,
          keyboardType: TextInputType.emailAddress,
          decoration: InputDecoration(
            labelText: _labelWithRequiredMarker,
            hintText: field.placeholder,
            errorText: errorText,
          ),
          onChanged: onChanged,
        );

      case DynamicFieldType.phone:
        return TextFormField(
          key: ValueKey(field.key),
          initialValue: value as String?,
          keyboardType: TextInputType.phone,
          decoration: InputDecoration(
            labelText: _labelWithRequiredMarker,
            hintText: field.placeholder,
            errorText: errorText,
          ),
          onChanged: onChanged,
        );

      case DynamicFieldType.date:
      case DynamicFieldType.text:
      case DynamicFieldType.unknown:
        return TextFormField(
          key: ValueKey(field.key),
          initialValue: value as String?,
          decoration: InputDecoration(
            labelText: _labelWithRequiredMarker,
            hintText: field.placeholder,
            errorText: errorText,
          ),
          onChanged: onChanged,
        );
    }
  }
}
