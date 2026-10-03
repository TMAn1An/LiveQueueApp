import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/models/token_journey.dart';
import 'package:mobile_app/widgets/journey_progress.dart';

/// ADR-070: after the token exists the journey is shown, never edited.
void main() {
  testWidgets('shows the current and next step, done steps, and offers no controls', (tester) async {
    final journey = TokenJourney.fromJson({
      'totalSteps': 3,
      'currentStepNumber': 2,
      'referredTo': {'id': 'c2', 'name': 'Pay 1'},
      'steps': [
        {'stepNumber': 1, 'serviceName': 'Registration', 'status': 'COMPLETED', 'counter': {'name': 'Desk 1'}},
        {'stepNumber': 2, 'serviceName': 'Payment', 'status': 'CALLED', 'counter': {'name': 'Pay 1'}},
        {'stepNumber': 3, 'serviceName': 'Pharmacy', 'status': 'PENDING', 'counter': null},
      ],
    })!;
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: JourneyProgress(journey: journey))));

    expect(find.text('Step 2 of 3 · Payment'), findsOneWidget);
    expect(find.text('Next: Pharmacy'), findsOneWidget);
    expect(find.text('You have been referred to Pay 1 for this step.'), findsOneWidget);
    expect(find.text('Done · Desk 1'), findsOneWidget);
    expect(find.text('Called · Pay 1'), findsOneWidget);
    expect(find.byType(IconButton), findsNothing);
    expect(find.byType(ReorderableListView), findsNothing);
  });
}
