import '../models/history_entry.dart';
import '../models/live_queue_token.dart';
import '../services/history_storage_service.dart';

class HistoryRepository {
  HistoryRepository({required HistoryStorageService storageService})
      : _storageService = storageService;

  final HistoryStorageService _storageService;

  Future<List<HistoryEntry>> getHistory() => _storageService.getAll();

  Future<void> recordJoin(HistoryEntry entry) => _storageService.add(entry);

  Future<void> recordStatusUpdate(String tokenId, TokenStatus status) =>
      _storageService.updateStatus(tokenId, status);

  Future<void> clear() => _storageService.clear();
}
