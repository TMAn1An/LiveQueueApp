import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/intl.dart';
import 'package:mobile_app/models/history_entry.dart';
import 'package:mobile_app/models/live_queue_token.dart';
import 'package:mobile_app/screens/token_details_screen.dart';

void main() {
  final localWallClock = DateTime(2026, 9, 2, 18, 30);

  HistoryEntry entry(TokenStatus status) => HistoryEntry(
        tokenId: 'token-1',
        queueId: 'queue-1',
        queueName: 'Customer Service',
        serviceId: 'service-1',
        serviceName: 'General Inquiry',
        serialNumber: 'A007',
        // Stored as the UTC instant, exactly as the backend sends it.
        createdAt: localWallClock.toUtc(),
        finalStatus: status,
      );

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
