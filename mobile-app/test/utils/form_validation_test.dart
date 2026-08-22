import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/models/dynamic_form_field.dart';
import 'package:mobile_app/utils/form_validation.dart';

DynamicFormField _field({
  required String key,
  required bool required,
  DynamicFieldType type = DynamicFieldType.text,
}) {
  return DynamicFormField(
    id: key,
    key: key,
    label: key,
    type: type,
    required: required,
    options: const [],
    sortOrder: 0,
  );
}

void main() {
  group('validateDynamicForm', () {
    test('passes when all required fields are present', () {
      final fields = [_field(key: 'fullName', required: true)];
      final result = validateDynamicForm(fields, {'fullName': 'Jane Doe'});
      expect(result.isValid, isTrue);
      expect(result.errorsByKey, isEmpty);
    });

    test('fails when a required field is missing entirely', () {
      final fields = [_field(key: 'fullName', required: true)];
      final result = validateDynamicForm(fields, {});
      expect(result.isValid, isFalse);
      expect(result.errorsByKey, contains('fullName'));
    });

    test('fails when a required field is an empty/blank string', () {
      final fields = [_field(key: 'fullName', required: true)];
      final result = validateDynamicForm(fields, {'fullName': '   '});
      expect(result.isValid, isFalse);
    });

    test('passes when an optional field is omitted', () {
      final fields = [_field(key: 'notes', required: false)];
      final result = validateDynamicForm(fields, {});
      expect(result.isValid, isTrue);
    });

    test('passes when an optional field is an empty string', () {
      final fields = [_field(key: 'notes', required: false)];
      final result = validateDynamicForm(fields, {'notes': ''});
      expect(result.isValid, isTrue);
    });

    test('reports every failing field, not just the first', () {
      final fields = [
        _field(key: 'fullName', required: true),
        _field(key: 'phone', required: true),
        _field(key: 'notes', required: false),
      ];
      final result = validateDynamicForm(fields, {});
      expect(result.errorsByKey.keys, containsAll(['fullName', 'phone']));
      expect(result.errorsByKey, isNot(contains('notes')));
    });
  });
}
