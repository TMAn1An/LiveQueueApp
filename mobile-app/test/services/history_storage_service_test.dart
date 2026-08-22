import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/models/history_entry.dart';
import 'package:mobile_app/models/live_queue_token.dart';
import 'package:mobile_app/services/history_storage_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

HistoryEntry _entry(String tokenId, {DateTime? createdAt}) {
  return HistoryEntry(
    tokenId: tokenId,
    queueId: 'queue-1',
    queueName: 'Customer Service',
    serviceId: 'service-1',
    serviceName: 'General Inquiry',
    serialNumber: 'A00${tokenId.hashCode % 10}',
    createdAt: createdAt ?? DateTime.utc(2026, 1, 1),
    finalStatus: TokenStatus.waiting,
  );
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('starts empty', () async {
    final service = HistoryStorageService();
    expect(await service.getAll(), isEmpty);
  });

  test('add() persists an entry and getAll() returns it, newest first', () async {
    final service = HistoryStorageService();
    await service.add(_entry('token-1'));
    await service.add(_entry('token-2'));

    final all = await service.getAll();
    expect(all.map((e) => e.tokenId).toList(), ['token-2', 'token-1']);
  });

  test('adding the same tokenId again replaces (not duplicates) the entry', () async {
    final service = HistoryStorageService();
    await service.add(_entry('token-1'));
    await service.add(_entry('token-1'));

    final all = await service.getAll();
    expect(all, hasLength(1));
  });

  test('caps stored history at maxEntries, dropping the oldest', () async {
    final service = HistoryStorageService();
    for (var i = 0; i < HistoryStorageService.maxEntries + 10; i++) {
      await service.add(_entry('token-$i'));
    }

    final all = await service.getAll();
    expect(all, hasLength(HistoryStorageService.maxEntries));
    // The most recently added entries are kept; the earliest ones are dropped.
    expect(all.first.tokenId, 'token-${HistoryStorageService.maxEntries + 9}');
    expect(all.map((e) => e.tokenId), isNot(contains('token-0')));
  });

  test('updateStatus() changes the stored finalStatus for a matching entry', () async {
    final service = HistoryStorageService();
    await service.add(_entry('token-1'));

    await service.updateStatus('token-1', TokenStatus.completed);

    final all = await service.getAll();
    expect(all.single.finalStatus, TokenStatus.completed);
  });

  test('updateStatus() is a no-op for an unknown tokenId', () async {
    final service = HistoryStorageService();
    await service.add(_entry('token-1'));

    await service.updateStatus('does-not-exist', TokenStatus.completed);

    final all = await service.getAll();
    expect(all.single.finalStatus, TokenStatus.waiting);
  });

  test('clear() empties the store', () async {
    final service = HistoryStorageService();
    await service.add(_entry('token-1'));
    await service.clear();
    expect(await service.getAll(), isEmpty);
  });

  group('corrupted local storage', () {
    const prefsKey = 'token_history'; // HistoryStorageService's private key

    test('missing storage returns []', () async {
      // Already covered by 'starts empty' above, restated explicitly here
      // alongside the other corruption cases for a single point of truth.
      final service = HistoryStorageService();
      expect(await service.getAll(), isEmpty);
    });

    test('valid JSON loads correctly (regression baseline for the cases below)', () async {
      final service = HistoryStorageService();
      await service.add(_entry('token-1'));
      expect(await service.getAll(), hasLength(1));
    });

    test('malformed JSON (not parseable at all) returns [] instead of throwing', () async {
      SharedPreferences.setMockInitialValues({prefsKey: '{not valid json!!'});
      final service = HistoryStorageService();

      final result = await service.getAll();

      expect(result, isEmpty);
    });

    test('structurally invalid JSON (valid JSON but not a list) returns [] instead of throwing', () async {
      SharedPreferences.setMockInitialValues({prefsKey: '{"unexpected": "an object, not a list"}'});
      final service = HistoryStorageService();

      final result = await service.getAll();

      expect(result, isEmpty);
    });

    test('a list of non-object entries returns [] instead of throwing', () async {
      SharedPreferences.setMockInitialValues({prefsKey: '["just", "some", "strings"]'});
      final service = HistoryStorageService();

      final result = await service.getAll();

      expect(result, isEmpty);
    });

    test('one corrupted entry among otherwise-valid entries is dropped, not the whole list', () async {
      final goodEntry = _entry('token-good').toJson();
      final badEntry = {'tokenId': 'token-bad'}; // missing every other required field
      SharedPreferences.setMockInitialValues({
        prefsKey: jsonEncode([goodEntry, badEntry]),
      });
      final service = HistoryStorageService();

      final result = await service.getAll();

      expect(result, hasLength(1));
      expect(result.single.tokenId, 'token-good');
    });

    test('getAll() never throws for any of the corruption cases above', () async {
      for (final corrupt in ['not json', '{"a":', '[1,2,3]', 'null', '']) {
        SharedPreferences.setMockInitialValues({prefsKey: corrupt});
        final service = HistoryStorageService();
        await expectLater(service.getAll(), completes);
      }
    });
  });
}
