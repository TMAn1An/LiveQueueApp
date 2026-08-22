import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/models/live_queue_token.dart';
import 'package:mobile_app/widgets/status_badge.dart';

void main() {
  Future<void> pumpBadge(WidgetTester tester, TokenStatus status) {
    return tester.pumpWidget(
      MaterialApp(home: Scaffold(body: StatusBadge(status: status))),
    );
  }

  testWidgets('shows "Waiting" for TokenStatus.waiting', (tester) async {
    await pumpBadge(tester, TokenStatus.waiting);
    expect(find.text('Waiting'), findsOneWidget);
  });

  testWidgets('shows "Your Turn" for TokenStatus.called', (tester) async {
    await pumpBadge(tester, TokenStatus.called);
    expect(find.text('Your Turn'), findsOneWidget);
  });

  testWidgets('shows "In Progress" for TokenStatus.inProgress', (tester) async {
    await pumpBadge(tester, TokenStatus.inProgress);
    expect(find.text('In Progress'), findsOneWidget);
  });

  testWidgets('shows "Completed" for TokenStatus.completed', (tester) async {
    await pumpBadge(tester, TokenStatus.completed);
    expect(find.text('Completed'), findsOneWidget);
  });

  testWidgets('shows "Skipped" for TokenStatus.skipped', (tester) async {
    await pumpBadge(tester, TokenStatus.skipped);
    expect(find.text('Skipped'), findsOneWidget);
  });
}
