import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/utils/qr_parser.dart';

void main() {
  group('QrParser.parseQueueId', () {
    test('parses a valid livequeue:// QR code', () {
      const queueId = 'a1b2c3d4-e5f6-4789-a123-b1c2d3e4f5a6';
      expect(QrParser.parseQueueId('livequeue://queue/$queueId'), queueId);
    });

    test('rejects an empty scan', () {
      expect(() => QrParser.parseQueueId(''), throwsA(isA<QrParseException>()));
    });

    test('rejects a QR code with the wrong scheme', () {
      expect(
        () => QrParser.parseQueueId('https://queue/a1b2c3d4-e5f6-4789-a123-b1c2d3e4f5a6'),
        throwsA(isA<QrParseException>()),
      );
    });

    test('rejects a QR code with the wrong host', () {
      expect(
        () => QrParser.parseQueueId('livequeue://organization/a1b2c3d4-e5f6-4789-a123-b1c2d3e4f5a6'),
        throwsA(isA<QrParseException>()),
      );
    });

    test('rejects a QR code with a missing queue id', () {
      expect(() => QrParser.parseQueueId('livequeue://queue/'), throwsA(isA<QrParseException>()));
    });

    test('rejects a QR code whose id is not a UUID', () {
      expect(
        () => QrParser.parseQueueId('livequeue://queue/not-a-real-id'),
        throwsA(isA<QrParseException>()),
      );
    });

    test('rejects completely unrelated text (e.g. a random URL)', () {
      expect(
        () => QrParser.parseQueueId('https://example.com/some/other/page'),
        throwsA(isA<QrParseException>()),
      );
    });

    test('rejects plain garbage text', () {
      expect(() => QrParser.parseQueueId('not a qr code at all'), throwsA(isA<QrParseException>()));
    });
  });

  _organizationTests();
  _contractTests();
}

/// ADR-068: the organization's one QR, which is also the iPhone portal link.
void _organizationTests() {
  group('QrParser.parse — organization QR', () {
    test('reads the code from the portal link, whatever the host', () {
      for (final raw in [
        'https://app.livequeue.example/visit/a1b2c3d4e5f6',
        'https://another.host/visit/a1b2c3d4e5f6/',
        '  https://app.livequeue.example/visit/A1B2C3D4E5F6\n',
      ]) {
        final parsed = QrParser.parse(raw);
        expect(parsed, isA<OrganizationQr>(), reason: raw);
        expect((parsed as OrganizationQr).publicCode, 'a1b2c3d4e5f6');
      }
    });

    test('still reads a legacy queue-only code', () {
      const queueId = '7f1c2b3a-9d4e-4c6f-8a1b-2c3d4e5f6a7b';
      final parsed = QrParser.parse('livequeue://queue/$queueId');
      expect(parsed, isA<QueueQr>());
      expect((parsed as QueueQr).queueId, queueId);
    });

    test('rejects a malformed code, other portal pages, and non-https links', () {
      for (final raw in [
        'https://app.livequeue.example/visit/ab',
        'https://app.livequeue.example/visit/abc-def-ghi',
        'https://app.livequeue.example/visit/token/abc123',
        'https://app.livequeue.example/visit',
        'http://app.livequeue.example/visit/a1b2c3d4e5f6',
        'https://example.com/some/other/page',
        'livequeue://organization/a1b2c3d4-e5f6-4789-a123-b1c2d3e4f5a6',
        '',
      ]) {
        expect(() => QrParser.parse(raw), throwsA(isA<QrParseException>()), reason: raw);
      }
    });
  });
}


/// The contract test for the QR flow: the exact string the backend puts in
/// `queue.qrCodeUri` (backend/src/services/queue.service.ts) is what the
/// dashboard encodes verbatim into the printed code, so the parser has to
/// accept that shape and nothing weaker.
void _contractTests() {
  group('dashboard/backend payload contract', () {
    // Mirrors `livequeue://queue/${queue.id}` with a real UUID v4 exactly as
    // Prisma generates it.
    const backendQueueId = '7f1c2b3a-9d4e-4c6f-8a1b-2c3d4e5f6a7b';
    const backendPayload = 'livequeue://queue/$backendQueueId';

    test('parses the payload the dashboard actually encodes', () {
      expect(QrParser.parseQueueId(backendPayload), backendQueueId);
    });

    test('tolerates the whitespace some scanners append', () {
      expect(QrParser.parseQueueId('  $backendPayload\n'), backendQueueId);
    });

    test('rejects a queue id that is not a UUID, so a typo never reaches the API', () {
      expect(
        () => QrParser.parseQueueId('livequeue://queue/7f1c2b3a'),
        throwsA(isA<QrParseException>()),
      );
    });
  });
}
