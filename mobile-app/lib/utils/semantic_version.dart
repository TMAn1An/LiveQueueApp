/// V2 Checkpoint 9: compares two version strings by major.minor.patch,
/// numerically — never lexicographically (so "1.10.0" is correctly newer
/// than "1.9.0", unlike a plain string comparison). Returns negative/zero/
/// positive like [Comparable.compareTo] (a < b, a == b, a > b).
///
/// This project's version strings (pubspec.yaml's `X.Y.Z+B`) don't attach
/// update-gating meaning to anything beyond major.minor.patch, so a
/// trailing build number ("+1") or any pre-release/build metadata suffix
/// ("-beta") is stripped before comparing — deliberately not implementing
/// full semver precedence rules (pre-release ordering, build-metadata
/// exclusion nuances) since nothing in this project currently uses them.
///
/// Never throws: a missing or non-numeric segment is treated as 0, so a
/// malformed version string degrades to a safe comparable value instead of
/// crashing version-policy evaluation at startup.
int compareSemanticVersions(String a, String b) {
  final partsA = _parseVersionParts(a);
  final partsB = _parseVersionParts(b);
  for (var i = 0; i < 3; i++) {
    final cmp = partsA[i].compareTo(partsB[i]);
    if (cmp != 0) return cmp;
  }
  return 0;
}

List<int> _parseVersionParts(String version) {
  final core = version.split('+').first.split('-').first;
  final segments = core.split('.');
  return List.generate(3, (i) {
    if (i >= segments.length) return 0;
    return int.tryParse(segments[i]) ?? 0;
  });
}
