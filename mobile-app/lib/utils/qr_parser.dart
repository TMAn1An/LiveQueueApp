/// Parses and validates the LiveQueue QR format (spec section 7.15):
///   livequeue://queue/{queueId}
///
/// "The backend must never trust the QR content by itself" — this parser
/// only extracts and shape-validates the queue id; the real validation is
/// the backend rejecting an unknown/invalid id when the app requests the
/// public queue config for it.
class QrParseException implements Exception {
  const QrParseException(this.message);
  final String message;

  @override
  String toString() => message;
}

class QrParser {
  QrParser._();

  static const String _scheme = 'livequeue';
  static const String _host = 'queue';
  static final RegExp _uuidPattern = RegExp(
    r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
  );

  /// Returns the extracted queue id, or throws [QrParseException] if the
  /// scanned content doesn't match the expected format.
  static String parseQueueId(String raw) {
    final trimmed = raw.trim();
    if (trimmed.isEmpty) {
      throw const QrParseException('QR code is empty.');
    }

    final uri = Uri.tryParse(trimmed);
    if (uri == null || uri.scheme != _scheme) {
      throw const QrParseException('This QR code is not a LiveQueue code.');
    }

    // Uri parses "livequeue://queue/{id}" with host="queue" and the id as
    // the first path segment.
    final segments = uri.pathSegments.where((s) => s.isNotEmpty).toList();
    if (uri.host != _host || segments.isEmpty) {
      throw const QrParseException('This QR code is not a valid queue code.');
    }

    final queueId = segments.first;
    if (!_uuidPattern.hasMatch(queueId)) {
      throw const QrParseException('This QR code has an invalid queue id.');
    }

    return queueId;
  }
}
