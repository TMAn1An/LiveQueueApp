import '../models/history_entry.dart';
import '../models/live_queue_token.dart';
import '../services/history_storage_service.dart';

class HistoryRepository {
  HistoryRepository({required HistoryStorageService storageService})
      : _storageService = storageService;

  final HistoryStorageService _storageService;

  Future<List<HistoryEntry>> getHistory() => _storageService.getAll();

  Future<void> recordJoin(HistoryEntry entry) => _storageService.add(entry);

  /// Records how a visit ended — its final status and, per ADR-042, why it
  /// was skipped or what staff noted on completion — from the backend's own
  /// token view, whichever path noticed the change.
  Future<void> recordFinalState(LiveQueueToken token) => _storageService.updateStatus(
        token.id,
        token.status,
        skipReason: token.status == TokenStatus.skipped ? token.skipReasonDisplay : null,
        completionFeedback: token.status == TokenStatus.completed ? token.completionFeedback : null,
      );

  Future<void> clear() => _storageService.clear();
}
