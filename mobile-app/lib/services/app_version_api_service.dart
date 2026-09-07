import '../models/app_version_policy.dart';
import 'api_client.dart';

/// GET /api/public/version-policy (V2 Checkpoint 9, ADR-031) — no auth,
/// public, additive. Android only for now, matching the backend's own
/// current scope.
class AppVersionApiService {
  AppVersionApiService(this._client);

  final ApiClient _client;

  /// Uses the shorter startup budget rather than the general request
  /// timeout: the customer is staring at the splash screen behind this call,
  /// and AppVersionRepository already treats a failure as "use the cached
  /// policy, or fail open" — so giving up early costs correctness nothing
  /// and saves the difference in startup time on a cold backend.
  Future<AppVersionPolicy> getVersionPolicy({String platform = 'android'}) async {
    final data = await _client.get(
      '/api/public/version-policy?platform=$platform',
      timeout: startupRequestTimeout,
    );
    return AppVersionPolicy.fromJson(data);
  }
}
