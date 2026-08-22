import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/utils/uuid_generator.dart';

void main() {
  final uuidV4Pattern = RegExp(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
  );

  test('generates a well-formed UUID v4', () {
    expect(uuidV4Pattern.hasMatch(generateUuidV4()), isTrue);
  });

  test('generates unique values across many calls', () {
    final generated = List.generate(500, (_) => generateUuidV4()).toSet();
    expect(generated.length, 500);
  });
}
