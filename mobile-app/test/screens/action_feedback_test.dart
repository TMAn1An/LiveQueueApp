import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/models/dynamic_form_field.dart';
import 'package:mobile_app/models/queue_config.dart';
import 'package:mobile_app/models/service_option.dart';
import 'package:mobile_app/providers/queue_join_provider.dart';
import 'package:mobile_app/repositories/device_repository.dart';
import 'package:mobile_app/repositories/history_repository.dart';
import 'package:mobile_app/repositories/phone_verification_repository.dart';
import 'package:mobile_app/repositories/queue_repository.dart';
import 'package:mobile_app/repositories/token_repository.dart';
import 'package:mobile_app/screens/dynamic_form_screen.dart';
import 'package:mobile_app/services/api_client.dart';
import 'package:mobile_app/services/device_api_service.dart';
import 'package:mobile_app/services/device_identity_service.dart';
import 'package:mobile_app/services/history_storage_service.dart';
import 'package:mobile_app/services/phone_verification_api_service.dart';
import 'package:mobile_app/services/queue_api_service.dart';
import 'package:mobile_app/services/socket_service.dart';
import 'package:mobile_app/services/token_api_service.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// A customer-visible action must never look like nothing happened. These
/// cover the two flows where the wait is a real network round-trip.
class _FakeQueueJoinProvider extends QueueJoinProvider {
  _FakeQueueJoinProvider()
    : super(
        queueRepository: QueueRepository(
          apiService: QueueApiService(ApiClient(baseUrl: 'http://localhost:4000')),
        ),
        tokenRepository: TokenRepository(
          apiService: TokenApiService(ApiClient(baseUrl: 'http://localhost:4000')),
          socketService: SocketService(),
        ),
        deviceRepository: DeviceRepository(
          identityService: DeviceIdentityService(),
          apiService: DeviceApiService(ApiClient(baseUrl: 'http://localhost:4000')),
        ),
        historyRepository: HistoryRepository(storageService: HistoryStorageService()),
        phoneVerificationRepository: PhoneVerificationRepository(
          apiService: PhoneVerificationApiService(ApiClient(baseUrl: 'http://localhost:4000')),
        ),
      );

  void setSubmitting(bool value) {
    isSubmitting = value;
    notifyListeners();
  }

  void setLoadingQueue(bool value) {
    isLoadingQueue = value;
    notifyListeners();
  }
}

QueueConfig _config() => const QueueConfig(
  id: 'queue-1',
  name: 'Front Desk',
  status: 'ACTIVE',
  services: [
    ServiceOption(id: 'service-1', serviceName: 'General', durationMinutes: 5),
  ],
  formFields: [
    DynamicFormField(
      id: 'f1',
      key: 'full_name',
      label: 'Full Name',
      type: DynamicFieldType.text,
      required: true,
      placeholder: null,
      options: [],
      sortOrder: 1,
    ),
  ],
);

Future<void> _pumpForm(WidgetTester tester, _FakeQueueJoinProvider provider) {
  return tester.pumpWidget(
    ChangeNotifierProvider<QueueJoinProvider>.value(
      value: provider,
      child: const MaterialApp(home: DynamicFormScreen()),
    ),
  );
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('the join button reports progress and cannot be tapped twice', (tester) async {
    final provider = _FakeQueueJoinProvider();
    provider.queueConfig = _config();
    provider.selectedServiceIds = {'service-1'};
    await _pumpForm(tester, provider);

    expect(find.text('Join Queue'), findsOneWidget);

    provider.setSubmitting(true);
    await tester.pump();

    expect(find.text('Joining queue…'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    final button = tester.widget<FilledButton>(find.byType(FilledButton));
    expect(button.onPressed, isNull, reason: 'a second tap must not be possible');
  });

  testWidgets('the join button becomes usable again once the attempt settles', (tester) async {
    final provider = _FakeQueueJoinProvider();
    provider.queueConfig = _config();
    provider.selectedServiceIds = {'service-1'};
    await _pumpForm(tester, provider);

    provider.setSubmitting(true);
    await tester.pump();
    // A failure clears the flag exactly like a success does, so the button can
    // never be stranded.
    provider.setSubmitting(false);
    provider.errorMessage = 'Something went wrong.';
    await tester.pump();

    expect(find.text('Join Queue'), findsOneWidget);
    expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed, isNotNull);
  });
}
