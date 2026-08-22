import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/providers/history_provider.dart';
import 'package:mobile_app/repositories/history_repository.dart';
import 'package:mobile_app/services/history_storage_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

HistoryProvider _buildProvider() {
  return HistoryProvider(
    historyRepository: HistoryRepository(storageService: HistoryStorageService()),
  );
}

void main() {
  const prefsKey = 'token_history';

  test('load() populates entries normally when storage is valid', () async {
    SharedPreferences.setMockInitialValues({
      prefsKey:
          '[{"tokenId":"t1","queueId":"q1","queueName":"Q","serviceId":"s1","serviceName":"S",'
          '"serialNumber":"A001","createdAt":"2026-01-01T00:00:00.000Z","finalStatus":"waiting"}]',
    });
    final provider = _buildProvider();

    await provider.load();

    expect(provider.entries, hasLength(1));
    expect(provider.isLoading, isFalse);
  });

  test('load() does not throw and resolves to an empty list when storage is corrupted', () async {
    SharedPreferences.setMockInitialValues({prefsKey: '{not valid json!!'});
    final provider = _buildProvider();

    await expectLater(provider.load(), completes);

    expect(provider.entries, isEmpty);
    expect(provider.isLoading, isFalse);
  });

  test('load() recovers isLoading to false even when storage is corrupted', () async {
    SharedPreferences.setMockInitialValues({prefsKey: '["not", "objects"]'});
    final provider = _buildProvider();

    final future = provider.load();
    expect(provider.isLoading, isTrue);

    await future;

    expect(provider.isLoading, isFalse);
    expect(provider.entries, isEmpty);
  });
}
