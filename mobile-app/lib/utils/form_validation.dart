import '../models/dynamic_form_field.dart';

/// Client-side validation is UX only — the backend is the actual authority
/// and re-validates everything (spec section 7.6: "Required fields must be
/// validated by backend and frontend" / CLAUDE.md: never trust frontend
/// validation is enough). This just gives the customer immediate feedback
/// before a round trip.
class FormValidationResult {
  const FormValidationResult({required this.isValid, required this.errorsByKey});
  final bool isValid;
  final Map<String, String> errorsByKey;
}

FormValidationResult validateDynamicForm(
  List<DynamicFormField> fields,
  Map<String, dynamic> formData,
) {
  final errors = <String, String>{};

  for (final field in fields) {
    if (!field.required) continue;

    final value = formData[field.key];
    final isBlank = value == null || (value is String && value.trim().isEmpty);
    if (isBlank) {
      errors[field.key] = '${field.label} is required.';
    }
  }

  return FormValidationResult(isValid: errors.isEmpty, errorsByKey: errors);
}
