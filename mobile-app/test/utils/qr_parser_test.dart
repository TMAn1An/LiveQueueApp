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
}
