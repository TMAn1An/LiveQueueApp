import 'api_client.dart';

/// POST /api/devices/register (approved Phase 3 decision 14) — idempotent;
/// the app can call this on every launch without creating duplicate rows.
class DeviceApiService {
  DeviceApiService(this._client);

  final ApiClient _client;

  Future<void> registerDevice(String deviceIdentifier) async {
    await _client.post('/api/devices/register', body: {'deviceIdentifier': deviceIdentifier});
  }

  /// POST /api/devices/fcm-token (Issue #5) — same upsert-on-deviceId trust
  /// model as [registerDevice]; safe to call repeatedly (initial
  /// registration and every onTokenRefresh) without creating duplicate rows,
  /// since the backend keys DeviceFcmToken by deviceId.
  Future<void> registerFcmToken(String deviceIdentifier, String fcmToken) async {
    await _client.post(
      '/api/devices/fcm-token',
      body: {'deviceIdentifier': deviceIdentifier, 'fcmToken': fcmToken},
    );
  }
}
