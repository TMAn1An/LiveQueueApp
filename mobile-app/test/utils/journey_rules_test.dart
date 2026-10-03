import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/utils/journey_rules.dart';

/// ADR-070: the app's copy of the backend's journey rules.
void main() {
  const rules = [
    JourneyServiceRule(id: 'reg', name: 'Registration', maxOccurrences: 1),
    JourneyServiceRule(id: 'lab', name: 'Lab'),
  ];

  test('a valid journey has no problems', () {
    expect(journeyProblems(['reg', 'lab'], rules), isEmpty);
    expect(journeyProblems(['lab', 'reg', 'lab'], rules), isEmpty);
  });

  test('empty, consecutive repeats and over-limit repeats are problems', () {
    expect(journeyProblems([], rules).single.code, 'JOURNEY_EMPTY');
    final consecutive = journeyProblems(['lab', 'lab'], rules).single;
    expect(consecutive.code, 'JOURNEY_CONSECUTIVE_REPEAT');
    expect(consecutive.stepNumber, 2);
    expect(
      journeyProblems(['reg', 'lab', 'reg'], rules).single.message,
      'Registration can be chosen at most 1 time.',
    );
    expect(
      journeyProblems(['lab', 'reg', 'lab', 'x', 'lab'], rules).map((p) => p.code),
      contains('JOURNEY_REPEAT_LIMIT'),
    );
  });

  test('canAppendStep and reorderStep', () {
    expect(canAppendStep(['lab'], 'lab', rules), isFalse);
    expect(canAppendStep(['reg', 'lab'], 'reg', rules), isFalse);
    expect(canAppendStep(['lab', 'reg'], 'lab', rules), isTrue);
    expect(reorderStep(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
  });
}
