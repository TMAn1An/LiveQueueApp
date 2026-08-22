/// Mirrors the backend's `FormFieldType` enum exactly (lowercase wire
/// values, backend/prisma/schema.prisma) — text/email/phone/date all render
/// as plain text inputs client-side; the backend is the authority on
/// validation (CLAUDE.md: never duplicate backend business rules).
enum DynamicFieldType { text, number, email, phone, date, dropdown, radio, checkbox, unknown }

DynamicFieldType _parseFieldType(String raw) {
  return DynamicFieldType.values.firstWhere(
    (t) => t.name == raw,
    orElse: () => DynamicFieldType.unknown,
  );
}

class DynamicFormField {
  const DynamicFormField({
    required this.id,
    required this.key,
    required this.label,
    required this.type,
    required this.required,
    required this.options,
    required this.sortOrder,
    this.placeholder,
  });

  final String id;
  final String key;
  final String label;
  final DynamicFieldType type;
  final bool required;
  final String? placeholder;
  final List<String> options;
  final int sortOrder;

  factory DynamicFormField.fromJson(Map<String, dynamic> json) {
    return DynamicFormField(
      id: json['id'] as String,
      key: json['key'] as String,
      label: json['label'] as String,
      type: _parseFieldType(json['type'] as String),
      required: json['required'] as bool,
      placeholder: json['placeholder'] as String?,
      options: (json['options'] as List<dynamic>? ?? const []).cast<String>(),
      sortOrder: json['sortOrder'] as int,
    );
  }
}
