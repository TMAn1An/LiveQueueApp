import '../utils/semantic_version.dart';

/// V2 Checkpoint 9 (ADR-031) — the raw, server-authoritative policy from
/// GET /api/public/version-policy. Deliberately mirrors the backend
/// response field-for-field; the actual comparison against the installed
/// version happens in [AppVersionCompatibility.evaluate], not here.
class AppVersionPolicy {
  const AppVersionPolicy({
    required this.platform,
    required this.minimumVersion,
    required this.latestVersion,
    required this.forceUpdate,
    required this.storeUrl,
    required this.message,
  });

  final String platform;
  final String minimumVersion;
  final String latestVersion;
  final bool forceUpdate;
  final String storeUrl;
  final String message;

  factory AppVersionPolicy.fromJson(Map<String, dynamic> json) {
    return AppVersionPolicy(
      platform: json['platform'] as String,
      minimumVersion: json['minimumVersion'] as String,
      latestVersion: json['latestVersion'] as String,
      forceUpdate: json['forceUpdate'] as bool? ?? false,
      storeUrl: json['storeUrl'] as String? ?? '',
      message: json['message'] as String? ?? '',
    );
  }

  Map<String, dynamic> toJson() => {
    'platform': platform,
    'minimumVersion': minimumVersion,
    'latestVersion': latestVersion,
    'forceUpdate': forceUpdate,
    'storeUrl': storeUrl,
    'message': message,
  };
}

/// The resolved result of checking the installed app against a policy —
/// what SplashScreen/UpdateRequiredScreen actually act on. [policy] is null
/// only in the fail-open case (no fresh fetch succeeded and no cached
/// policy existed) — see AppVersionRepository.
class AppVersionCompatibility {
  const AppVersionCompatibility({
    required this.installedVersion,
    required this.policy,
    required this.updateRequired,
    required this.updateAvailable,
  });

  final String installedVersion;
  final AppVersionPolicy? policy;
  final bool updateRequired;
  final bool updateAvailable;

  /// Fail-open: no usable policy (fetch failed, no cache) means the app is
  /// always treated as compatible — a policy-service outage must never
  /// become a global mobile outage.
  factory AppVersionCompatibility.compatible(String installedVersion) {
    return AppVersionCompatibility(
      installedVersion: installedVersion,
      policy: null,
      updateRequired: false,
      updateAvailable: false,
    );
  }

  /// installedVersion < minimumVersion blocks; policy.forceUpdate is an
  /// additive OR on top of that (an emergency kill switch), never a
  /// contradiction — it can only ever widen blocking, never narrow it
  /// (see ADR-031).
  factory AppVersionCompatibility.evaluate(String installedVersion, AppVersionPolicy policy) {
    final belowMinimum = compareSemanticVersions(installedVersion, policy.minimumVersion) < 0;
    final belowLatest = compareSemanticVersions(installedVersion, policy.latestVersion) < 0;
    return AppVersionCompatibility(
      installedVersion: installedVersion,
      policy: policy,
      updateRequired: belowMinimum || policy.forceUpdate,
      updateAvailable: belowLatest,
    );
  }
}
