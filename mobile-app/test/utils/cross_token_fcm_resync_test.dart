import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/utils/cross_token_fcm_resync.dart';

// V2 Physical Validation + Foreground Notification checkpoint, Part J:
// closes the cross-token gap (a status change on a token that isn't the one
// currently live-tracked) without a permanent per-token Socket.io
// subscription — a foreground FCM push already carries enough to target a
// resync at exactly the right token, safely, for every case that shouldn't
// trigger one.

void main() {
  String? resolve(
    Map<String, dynamic> data, {
    String? tracked,
    Set<String> remembered = const {},
  }) {
    return tokenIdToResyncFor(
      data: data,
      currentlyTrackedTokenId: tracked,
      isRemembered: remembered.contains,
    );
  }

  test('resyncs a remembered token that is not the one being tracked', () {
    final result = resolve(
      {'type': 'token_status_changed', 'tokenId': 'token-b'},
      tracked: 'token-a',
      remembered: {'token-a', 'token-b'},
    );

    expect(result, 'token-b');
  });

  test('ignores a routine event type it does not understand (no spamming resyncs)', () {
    final result = resolve(
      {'type': 'token_eta_updated', 'tokenId': 'token-b'},
      remembered: {'token-b'},
    );

    expect(result, isNull);
  });

  test('ignores an unrelated event type entirely', () {
    final result = resolve(
      {'type': 'something_else', 'tokenId': 'token-b'},
      remembered: {'token-b'},
    );

    expect(result, isNull);
  });

  test('never resyncs the token already being live-tracked — it has a faster path', () {
    final result = resolve(
      {'type': 'token_status_changed', 'tokenId': 'token-a'},
      tracked: 'token-a',
      remembered: {'token-a'},
    );

    expect(result, isNull);
  });

  test('ignores a token id this installation does not remember', () {
    final result = resolve(
      {'type': 'token_status_changed', 'tokenId': 'token-unknown'},
      remembered: {'token-a', 'token-b'},
    );

    expect(result, isNull);
  });

  group('malformed events fail safely', () {
    test('missing tokenId', () {
      expect(resolve({'type': 'token_status_changed'}, remembered: {'token-a'}), isNull);
    });

    test('null tokenId', () {
      expect(
        resolve({'type': 'token_status_changed', 'tokenId': null}, remembered: {'token-a'}),
        isNull,
      );
    });

    test('non-string tokenId', () {
      expect(
        resolve({'type': 'token_status_changed', 'tokenId': 42}, remembered: {'token-a'}),
        isNull,
      );
    });

    test('empty-string tokenId', () {
      expect(
        resolve({'type': 'token_status_changed', 'tokenId': ''}, remembered: {'token-a'}),
        isNull,
      );
    });

    test('completely empty payload', () {
      expect(resolve(const {}), isNull);
    });
  });
}
