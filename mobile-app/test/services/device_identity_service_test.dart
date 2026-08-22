import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/services/device_identity_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('generates a device identifier on first call', () async {
    final service = DeviceIdentityService();
    final id = await service.getOrCreateDeviceIdentifier();
    expect(id, isNotEmpty);
  });

  test('returns the same identifier on subsequent calls (persisted)', () async {
    final service = DeviceIdentityService();
    final first = await service.getOrCreateDeviceIdentifier();
    final second = await service.getOrCreateDeviceIdentifier();
    expect(second, first);
  });

  test('a new service instance reads the same persisted identifier', () async {
    final first = await DeviceIdentityService().getOrCreateDeviceIdentifier();
    final second = await DeviceIdentityService().getOrCreateDeviceIdentifier();
    expect(second, first);
  });
}
