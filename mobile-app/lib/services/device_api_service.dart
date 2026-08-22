import 'api_client.dart';

/// POST /api/devices/register (approved Phase 3 decision 14) — idempotent;
/// the app can call this on every launch without creating duplicate rows.
class DeviceApiService {
  DeviceApiService(this._client);

  final ApiClient _client;

  Future<void> registerDevice(String deviceIdentifier) async {
    await _client.post('/api/devices/register', body: {'deviceIdentifier': deviceIdentifier});
  }
}
