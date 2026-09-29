import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/intl.dart';
import 'package:mobile_app/models/history_entry.dart';
import 'package:mobile_app/models/live_queue_token.dart';
import 'package:mobile_app/screens/token_details_screen.dart';

void main() {
  final localWallClock = DateTime(2026, 9, 2, 18, 30);

  HistoryEntry entry(TokenStatus status, {String? skipReason, String? completionFeedback}) => HistoryEntry(
        tokenId: 'token-1',
        queueId: 'queue-1',
        queueName: 'Customer Service',
        serviceId: 'service-1',
        serviceName: 'General Inquiry',
        serialNumber: 'A007',
        // Stored as the UTC instant, exactly as the backend sends it.
        createdAt: localWallClock.toUtc(),
        finalStatus: status,
        skipReason: skipReason,
        completionFeedback: completionFeedback,
      );

  testWidgets('ADR-042: a skipped visit shows why it was skipped', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: TokenDetailsScreen(entry: entry(TokenStatus.skipped, skipReason: 'Wrong queue, please use Billing')),
    ));

    expect(find.text('Skipped'), findsOneWidget);
    expect(find.text('Reason'), findsOneWidget);
    expect(find.text('Wrong queue, please use Billing'), findsOneWidget);
  });

  testWidgets('ADR-042: a completed visit shows its feedback only when there is some', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: TokenDetailsScreen(
        entry: entry(TokenStatus.completed, completionFeedback: 'Please bring the original document next time.'),
      ),
    ));
    expect(find.text('Feedback'), findsOneWidget);
    expect(find.text('Please bring the original document next time.'), findsOneWidget);

    await tester.pumpWidget(MaterialApp(home: TokenDetailsScreen(entry: entry(TokenStatus.completed))));
    expect(find.text('Feedback'), findsNothing);
    expect(find.text('Reason'), findsNothing);
  });

  testWidgets('shows the created time in the device timezone', (tester) async {
    await tester.pumpWidget(
      MaterialApp(home: TokenDetailsScreen(entry: entry(TokenStatus.completed))),
    );

    expect(
      find.text(DateFormat.yMMMd().add_jm().format(localWallClock)),
      findsOneWidget,
    );
  });

  testWidgets('shows a readable "Cancelled" final status, not a raw enum name', (tester) async {
    await tester.pumpWidget(
      MaterialApp(home: TokenDetailsScreen(entry: entry(TokenStatus.cancelled))),
    );

    expect(find.text('Cancelled'), findsOneWidget);
    expect(find.text('cancelled'), findsNothing);
  });
}
