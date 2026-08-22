import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/widgets/connection_indicator.dart';

void main() {
  testWidgets('shows "Reconnecting…" when disconnected', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: ConnectionIndicator(isConnected: false))),
    );
    expect(find.text('Reconnecting…'), findsOneWidget);
  });

  testWidgets('shows "Live" when connected and not resyncing', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: ConnectionIndicator(isConnected: true))),
    );
    expect(find.text('Live'), findsOneWidget);
  });

  testWidgets('shows "Updating…" when connected but resyncing', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: ConnectionIndicator(isConnected: true, isResyncing: true)),
      ),
    );
    expect(find.text('Updating…'), findsOneWidget);
  });
}
