import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/widgets/generic_error_widget.dart';

void main() {
  testWidgets('shows a safe, generic message', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: GenericErrorWidget())),
    );

    expect(find.text('Something went wrong'), findsOneWidget);
  });
}
