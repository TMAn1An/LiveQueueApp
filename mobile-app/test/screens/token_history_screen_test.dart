// Covers the two V2 mobile history defects together, through the real
// storage -> repository -> provider -> screen path: a CANCELLED token used
// to render as "Unknown", and timestamps were formatted in UTC instead of
// the device's own timezone.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/intl.dart';
import 'package:mobile_app/providers/history_provider.dart';
import 'package:mobile_app/repositories/history_repository.dart';
import 'package:mobile_app/screens/token_history_screen.dart';
import 'package:mobile_app/services/history_storage_service.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// A local wall clock, stored the way the backend sends it: as the UTC
/// instant for that moment. Written this way so the expected output is the
/// same regardless of which timezone the test machine is in.
final _localWallClock = DateTime(2026, 9, 2, 18, 30);

void _seedHistory({required String finalStatus}) {
  SharedPreferences.setMockInitialValues({
    'token_history': jsonEncode([
      {
        'tokenId': 'token-1',
        'queueId': 'queue-1',
        'queueName': 'Customer Service',
        'serviceId': 'service-1',
        'serviceName': 'General Inquiry',
        'serialNumber': 'A007',
        'createdAt': _localWallClock.toUtc().toIso8601String(),
        'finalStatus': finalStatus,
      },
    ]),
  });
}

Widget _screenUnderTest() {
  return ChangeNotifierProvider<HistoryProvider>(
    create: (_) => HistoryProvider(
      historyRepository: HistoryRepository(storageService: HistoryStorageService()),
    ),
    child: const MaterialApp(home: TokenHistoryScreen()),
  );
}

void main() {
  testWidgets('renders a cancelled token as "Cancelled", not "Unknown"', (tester) async {
    _seedHistory(finalStatus: 'cancelled');

    await tester.pumpWidget(_screenUnderTest());
    await tester.pumpAndSettle();

    expect(find.text('Cancelled'), findsOneWidget);
    expect(find.text('Unknown'), findsNothing);
  });

  testWidgets('shows the join time in the device timezone, not UTC', (tester) async {
    _seedHistory(finalStatus: 'completed');

    await tester.pumpWidget(_screenUnderTest());
    await tester.pumpAndSettle();

    final expected = DateFormat.yMMMd().add_jm().format(_localWallClock);
    expect(find.textContaining(expected), findsOneWidget);
  });

  testWidgets('a status this app version does not know still shows "Unknown"', (tester) async {
    _seedHistory(finalStatus: 'a_future_status');

    await tester.pumpWidget(_screenUnderTest());
    await tester.pumpAndSettle();

    expect(find.text('Unknown'), findsOneWidget);
  });
}
