import 'dart:convert';

import 'package:package_info_plus/package_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/app_version_policy.dart';
import '../services/app_version_api_service.dart';

/// V2 Checkpoint 9 (ADR-031): resolves whether the installed app is allowed
/// to continue. Combines a fresh policy fetch with a local cache and a
/// fail-open default, per the checkpoint's own explicit strategy:
///
/// - successful fetch -> evaluate against it, then cache it (replacing
///   whatever was cached before)
/// - fetch fails, a cached policy exists -> evaluate against the cached
///   one (a real outage must not let an already-known-incompatible install
///   silently start working again just because the network is down)
/// - fetch fails, no cache (or the cache is malformed) -> fail open,
///   compatible — a version-policy outage must never become a global
///   mobile outage
class AppVersionRepository {
  AppVersionRepository({required AppVersionApiService apiService}) : _apiService = apiService;

  final AppVersionApiService _apiService;

  static const _cacheKey = 'app_version_policy_cache_v1';

  Future<AppVersionCompatibility> checkCompatibility({String platform = 'android'}) async {
    final installedVersion = (await PackageInfo.fromPlatform()).version;

    try {
      final policy = await _apiService.getVersionPolicy(platform: platform);
      await _cachePolicy(policy);
      return AppVersionCompatibility.evaluate(installedVersion, policy);
    } catch (_) {
      final cached = await _loadCachedPolicy();
      if (cached == null) {
        return AppVersionCompatibility.compatible(installedVersion);
      }
      return AppVersionCompatibility.evaluate(installedVersion, cached);
    }
  }

  Future<void> _cachePolicy(AppVersionPolicy policy) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_cacheKey, jsonEncode(policy.toJson()));
    } catch (_) {
      // Caching is best-effort — a failure here must never affect the
      // fetch result already computed above.
    }
  }

  Future<AppVersionPolicy?> _loadCachedPolicy() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_cacheKey);
      if (raw == null) return null;
      final decoded = jsonDecode(raw);
      if (decoded is! Map<String, dynamic>) return null;
      return AppVersionPolicy.fromJson(decoded);
    } catch (_) {
      // A corrupt/malformed cache must never crash startup — treated
      // identically to "no cache at all" (fail open).
      return null;
    }
  }
}
