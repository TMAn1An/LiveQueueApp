import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/models/dynamic_form_field.dart';
import 'package:mobile_app/models/queue_config.dart';

void main() {
  test('parses the actual public queue config shape (no organization_name/state block)', () {
    final config = QueueConfig.fromJson({
      'id': 'queue-1',
      'name': 'Customer Service',
      'description': 'General support',
      'status': 'ACTIVE',
      'clientTerminology': 'Customer',
      'services': [
        {'id': 'service-1', 'serviceName': 'General Inquiry', 'description': null, 'durationMinutes': 5},
      ],
      'formFields': [
        {
          'id': 'field-1',
          'key': 'phone',
          'label': 'Phone',
          'type': 'phone',
          'required': true,
          'placeholder': null,
          'options': [],
          'sortOrder': 0,
        },
      ],
    });

    expect(config.id, 'queue-1');
    expect(config.isAcceptingCustomers, isTrue);
    expect(config.services, hasLength(1));
    expect(config.services.first.serviceName, 'General Inquiry');
    expect(config.formFields, hasLength(1));
    expect(config.formFields.first.type, DynamicFieldType.phone);
  });

  test('isAcceptingCustomers is false for PAUSED/INACTIVE', () {
    for (final status in ['PAUSED', 'INACTIVE']) {
      final config = QueueConfig.fromJson({
        'id': 'queue-1',
        'name': 'Q',
        'status': status,
        'services': [],
        'formFields': [],
      });
      expect(config.isAcceptingCustomers, isFalse, reason: 'for status $status');
    }
  });

  test('tolerates missing services/formFields arrays', () {
    final config = QueueConfig.fromJson({'id': 'queue-1', 'name': 'Q', 'status': 'ACTIVE'});
    expect(config.services, isEmpty);
    expect(config.formFields, isEmpty);
  });

  test('an unrecognized field type maps to unknown rather than throwing', () {
    final field = DynamicFormField.fromJson({
      'id': 'f1',
      'key': 'x',
      'label': 'X',
      'type': 'not-a-real-type',
      'required': false,
      'options': [],
      'sortOrder': 0,
    });
    expect(field.type, DynamicFieldType.unknown);
  });
}
