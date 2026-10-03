/// Parses and validates the LiveQueue QR formats:
///   https://{any host}/visit/{organizationPublicCode}   (ADR-068, current)
///   livequeue://queue/{queueId}                         (spec 7.15, legacy)
///
/// The organization code is the one printed QR per organization; the same
/// link opens the iPhone/iPad web portal. The host part is deliberately not
/// trusted or used: the app always asks its own configured backend, so a
/// look-alike domain can at most name a code that the backend then refuses.
/// Printed queue-only codes keep working for the Android app (migration —
/// see ADR-068).
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

/// What a scanned code names.
sealed class ScannedQr {
  const ScannedQr();
}

/// A legacy single-queue code.
class QueueQr extends ScannedQr {
  const QueueQr(this.queueId);
  final String queueId;
}

/// An organization's code: leads to its list of queues.
class OrganizationQr extends ScannedQr {
  const OrganizationQr(this.publicCode);
  final String publicCode;
}

class QrParser {
  QrParser._();

  static const String _scheme = 'livequeue';
  static const String _host = 'queue';
  static final RegExp _uuidPattern = RegExp(
    r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
  );

  static final RegExp _publicCodePattern = RegExp(r'^[a-z0-9]{6,32}$');

  /// Accepts both formats. Throws [QrParseException] for anything else.
  static ScannedQr parse(String raw) {
    final trimmed = raw.trim();
    final uri = Uri.tryParse(trimmed);
    if (uri != null && uri.scheme == 'https') {
      final segments = uri.pathSegments.where((s) => s.isNotEmpty).toList();
      if (segments.length == 2 && segments.first == 'visit') {
        final code = segments[1].toLowerCase();
        if (_publicCodePattern.hasMatch(code)) return OrganizationQr(code);
        throw const QrParseException('This QR code has an invalid organization code.');
      }
    }
    return QueueQr(parseQueueId(trimmed));
  }

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
