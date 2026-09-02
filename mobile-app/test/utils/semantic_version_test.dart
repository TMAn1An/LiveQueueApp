import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/utils/semantic_version.dart';

void main() {
  group('compareSemanticVersions', () {
    test('numeric, not lexicographic — 1.9.0 < 1.10.0', () {
      expect(compareSemanticVersions('1.9.0', '1.10.0'), lessThan(0));
      expect(compareSemanticVersions('1.10.0', '1.9.0'), greaterThan(0));
    });

    test('patch-level difference — 1.0.0 < 1.0.1', () {
      expect(compareSemanticVersions('1.0.0', '1.0.1'), lessThan(0));
    });

    test('major-level difference — 2.0.0 > 1.99.99', () {
      expect(compareSemanticVersions('2.0.0', '1.99.99'), greaterThan(0));
    });

    test('equality', () {
      expect(compareSemanticVersions('1.2.3', '1.2.3'), 0);
    });

    test('ignores a trailing build number, matching pubspec.yaml\'s X.Y.Z+B format', () {
      expect(compareSemanticVersions('1.0.0+12', '1.0.0+1'), 0);
    });

    test('malformed input degrades safely rather than throwing', () {
      expect(() => compareSemanticVersions('not-a-version', '1.0.0'), returnsNormally);
      expect(compareSemanticVersions('', '1.0.0'), lessThan(0));
      expect(compareSemanticVersions('1', '1.0.0'), 0);
    });
  });
}
