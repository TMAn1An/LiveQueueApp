/// Thrown by API services for any non-2xx response. Mirrors the backend's
/// `{ success: false, error: { code, message } }` envelope (all Phase 1-4
/// endpoints use this shape) so the UI can react to specific error codes
/// (e.g. QUEUE_ARCHIVED, DEVICE_BLOCKED, IDEMPOTENCY_KEY_CONFLICT) without
/// parsing message strings.
class ApiException implements Exception {
  const ApiException({
    required this.statusCode,
    required this.code,
    required this.message,
  });

  final int statusCode;
  final String code;
  final String message;

  @override
  String toString() => 'ApiException($statusCode, $code): $message';
}

/// Thrown when the device has no network connectivity or the request
/// otherwise never reached the server (spec section 25: "network failure").
class NetworkException implements Exception {
  const NetworkException(this.message);
  final String message;

  @override
  String toString() => message;
}
