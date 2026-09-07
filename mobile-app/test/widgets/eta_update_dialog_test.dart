import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/intl.dart';
import 'package:mobile_app/models/eta_update_notice.dart';
import 'package:mobile_app/widgets/eta_update_dialog.dart';

void main() {
  // Written as "a local wall clock, expressed as the UTC instant the backend
  // would send", so the expectation holds in any machine timezone.
  final localWallClock = DateTime(2026, 9, 7, 20, 35);

  Future<void> pumpDialog(WidgetTester tester, EtaUpdateNotice notice) {
    return tester.pumpWidget(
      MaterialApp(home: Scaffold(body: EtaUpdateDialog(notice: notice))),
    );
  }

  testWidgets('shows the new expected time in the device timezone', (tester) async {
    await pumpDialog(
      tester,
      EtaUpdateNotice(estimatedReadyAt: localWallClock.toUtc(), estimatedWaitMinutes: 18),
    );

    expect(find.text('Estimated time updated'), findsOneWidget);
    expect(
      find.text('New expected time: ${DateFormat.jm().format(localWallClock)}'),
      findsOneWidget,
    );
    expect(find.text('Approximately 18 minutes remaining.'), findsOneWidget);
  });

  testWidgets('offers a labelled close control', (tester) async {
    await pumpDialog(
      tester,
      EtaUpdateNotice(estimatedReadyAt: localWallClock.toUtc(), estimatedWaitMinutes: 5),
    );

    final closeButton = find.byTooltip('Close');
    expect(closeButton, findsOneWidget);
    expect(find.byIcon(Icons.close), findsOneWidget);
  });

  testWidgets('renders without a time when the backend could not estimate one', (tester) async {
    await pumpDialog(
      tester,
      const EtaUpdateNotice(estimatedReadyAt: null, estimatedWaitMinutes: null),
    );

    expect(find.text('Your estimated service time has changed.'), findsOneWidget);
    expect(find.textContaining('New expected time'), findsNothing);
  });
}
