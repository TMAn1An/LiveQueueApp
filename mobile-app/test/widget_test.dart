// Smoke test for HomeScreen. Deliberately does not pump the full
// LiveQueueApp/SplashScreen: SplashScreen's bootstrap touches real platform
// channels (flutter_local_notifications, Firebase) that aren't available in
// the widget-test sandbox without extensive mocking, and that startup
// plumbing isn't what this test is verifying — HomeScreen's own rendering
// and navigation is.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/providers/queue_join_provider.dart';
import 'package:mobile_app/repositories/device_repository.dart';
import 'package:mobile_app/repositories/history_repository.dart';
import 'package:mobile_app/repositories/queue_repository.dart';
import 'package:mobile_app/repositories/token_repository.dart';
import 'package:mobile_app/screens/home_screen.dart';
import 'package:mobile_app/screens/qr_scanner_screen.dart';
import 'package:mobile_app/services/api_client.dart';
import 'package:mobile_app/services/device_api_service.dart';
import 'package:mobile_app/services/device_identity_service.dart';
import 'package:mobile_app/services/history_storage_service.dart';
import 'package:mobile_app/services/queue_api_service.dart';
import 'package:mobile_app/services/socket_service.dart';
import 'package:mobile_app/services/token_api_service.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

Widget _homeScreenUnderTest() {
  final apiClient = ApiClient(baseUrl: 'http://localhost:4000');
  return ChangeNotifierProvider<QueueJoinProvider>(
    create: (_) => QueueJoinProvider(
      queueRepository: QueueRepository(apiService: QueueApiService(apiClient)),
      tokenRepository: TokenRepository(
        apiService: TokenApiService(apiClient),
        socketService: SocketService(),
      ),
      deviceRepository: DeviceRepository(
        identityService: DeviceIdentityService(),
        apiService: DeviceApiService(apiClient),
      ),
      historyRepository: HistoryRepository(storageService: HistoryStorageService()),
    ),
    child: const MaterialApp(home: HomeScreen()),
  );
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('HomeScreen shows the primary join action', (tester) async {
    await tester.pumpWidget(_homeScreenUnderTest());

    expect(find.text('LiveQueue'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Scan QR Code'), findsOneWidget);
    expect(find.widgetWithText(OutlinedButton, 'Token History'), findsOneWidget);
    expect(find.widgetWithText(OutlinedButton, 'Settings'), findsOneWidget);
  });

  testWidgets('tapping "Scan QR Code" navigates to the QR scanner screen', (tester) async {
    await tester.pumpWidget(_homeScreenUnderTest());

    await tester.tap(find.widgetWithText(FilledButton, 'Scan QR Code'));
    await tester.pumpAndSettle();

    expect(find.byType(QrScannerScreen), findsOneWidget);
  });
}
