import 'dart:math';

/// Securely-random UUID v4 generator, used both for the persisted device
/// identifier and for per-request Idempotency-Key values (spec section 26).
/// No `uuid` package dependency needed for this one small piece of logic.
String generateUuidV4() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));

  // Per RFC 4122: set version (4) and variant (10) bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  String hex(int start, int end) =>
      bytes.sublist(start, end).map((b) => b.toRadixString(16).padLeft(2, '0')).join();

  return '${hex(0, 4)}-${hex(4, 6)}-${hex(6, 8)}-${hex(8, 10)}-${hex(10, 16)}';
}
