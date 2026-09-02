import '../models/app_version_policy.dart';
import 'api_client.dart';

/// GET /api/public/version-policy (V2 Checkpoint 9, ADR-031) — no auth,
/// public, additive. Android only for now, matching the backend's own
/// current scope.
class AppVersionApiService {
  AppVersionApiService(this._client);

  final ApiClient _client;

  Future<AppVersionPolicy> getVersionPolicy({String platform = 'android'}) async {
    final data = await _client.get('/api/public/version-policy?platform=$platform');
    return AppVersionPolicy.fromJson(data);
  }
}
