import '../services/device_api_service.dart';
import '../services/device_identity_service.dart';

/// Single source of truth for "who is this device" — combines the local
/// persisted identifier with backend registration (Phase 3 approved
/// decision 14). ViewModels never touch shared_preferences or the register
/// endpoint directly.
class DeviceRepository {
  DeviceRepository({
    required DeviceIdentityService identityService,
    required DeviceApiService apiService,
  })  : _identityService = identityService,
        _apiService = apiService;

  final DeviceIdentityService _identityService;
  final DeviceApiService _apiService;

  String? _cachedDeviceIdentifier;

  /// Resolves (creating if necessary) the local device identifier and
  /// ensures the backend knows about it. Safe to call on every app launch —
  /// registration is idempotent.
  Future<String> ensureRegisteredDevice() async {
    final identifier = _cachedDeviceIdentifier ?? await _identityService.getOrCreateDeviceIdentifier();
    _cachedDeviceIdentifier = identifier;
    await _apiService.registerDevice(identifier);
    return identifier;
  }

  /// Issue #5: registers this device's current FCM token with the backend
  /// so token-status-change pushes have somewhere to go. Safe to call
  /// repeatedly (initial registration and every token refresh) — the
  /// backend upserts on deviceId, matching [ensureRegisteredDevice]'s own
  /// idempotency contract.
  Future<void> registerFcmToken(String fcmToken) async {
    final identifier = _cachedDeviceIdentifier ?? await _identityService.getOrCreateDeviceIdentifier();
    _cachedDeviceIdentifier = identifier;
    await _apiService.registerFcmToken(identifier, fcmToken);
  }
}
