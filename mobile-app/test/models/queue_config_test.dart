import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/models/dynamic_form_field.dart';
import 'package:mobile_app/models/queue_config.dart';
import 'package:mobile_app/models/queue_schedule_status.dart';

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

  test('Phase 4: a queue with no schedule block is fully open, exactly as before this feature existed', () {
    final config = QueueConfig.fromJson({'id': 'queue-1', 'name': 'Q', 'status': 'ACTIVE'});
    expect(config.schedule.scheduleEnabled, isFalse);
    expect(config.isAcceptingCustomers, isTrue);
  });

  test('Phase 4: isAcceptingCustomers is false while the schedule reports closed, even for an ACTIVE queue', () {
    final config = QueueConfig.fromJson({
      'id': 'queue-1',
      'name': 'Q',
      'status': 'ACTIVE',
      'schedule': {
        'scheduleEnabled': true,
        'isOpenNow': false,
        'message': 'This queue opens today at 09:00.',
        'todaySessions': [
          {'startMinute': 540, 'endMinute': 720},
        ],
      },
    });
    expect(config.isAcceptingCustomers, isFalse);
    expect(config.schedule.message, 'This queue opens today at 09:00.');
    expect(config.schedule.todaySessions.single.label, '09:00–12:00');
  });

  test('ADR-048: before the next session the queue still accepts joins, with the backend note', () {
    final config = QueueConfig.fromJson({
      'id': 'queue-1',
      'name': 'Q',
      'status': 'ACTIVE',
      'schedule': {
        'scheduleEnabled': true,
        'isOpenNow': false,
        'acceptingJoins': true,
        'nextSessionStartMinute': 840,
        'message': 'The next session starts today at 14:00. You can join now and will be served in a later session.',
        'todaySessions': null,
      },
    });
    expect(config.isAcceptingCustomers, isTrue);
    expect(config.schedule.isOpenNow, isFalse);
    expect(config.schedule.nextSessionStartMinute, 840);
    expect(config.schedule.todaySessions, isEmpty);
  });

  test('ADR-048: once every session today has ended, joining is refused', () {
    final config = QueueConfig.fromJson({
      'id': 'queue-1',
      'name': 'Q',
      'status': 'ACTIVE',
      'schedule': {
        'scheduleEnabled': true,
        'isOpenNow': false,
        'acceptingJoins': false,
        'unavailableCode': 'SCHEDULE_ENDED_TODAY',
        'message': "All of today's sessions have ended. Please come back on another day.",
      },
    });
    expect(config.isAcceptingCustomers, isFalse);
  });

  test('ADR-049: the repeat restriction scope is parsed, and absent means queue-wide', () {
    QueueConfig parse(Map<String, dynamic> identity) => QueueConfig.fromJson({
          'id': 'queue-1',
          'name': 'Q',
          'status': 'ACTIVE',
          'identity': identity,
        });

    final perSession = parse({
      'repeatRestricted': true,
      'restrictionScope': 'SESSION',
      'restrictionType': 'ONCE_EVER',
      'identityMode': 'CUSTOM_FIELD',
    });
    expect(perSession.identity.isPerSession, isTrue);

    final legacy = parse({'repeatRestricted': true, 'restrictionType': 'ONCE_EVER'});
    expect(legacy.identity.restrictionScope, isNull);
    expect(legacy.identity.isPerSession, isFalse);
  });

  test('ADR-048: an assigned session carries its absolute start instant', () {
    final window = QueueSessionWindow.fromJson({
      'startMinute': 840,
      'endMinute': 1020,
      'startsAt': '2026-10-01T08:00:00.000Z',
    });
    expect(window.label, '14:00–17:00');
    expect(window.startsAt, DateTime.utc(2026, 10, 1, 8));
    expect(QueueSessionWindow.fromJson({'startMinute': 0, 'endMinute': 60}).startsAt, isNull);
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
