import 'package:flutter/foundation.dart';

import '../models/history_entry.dart';
import '../repositories/history_repository.dart';

class HistoryProvider extends ChangeNotifier {
  HistoryProvider({required HistoryRepository historyRepository})
      : _historyRepository = historyRepository;

  final HistoryRepository _historyRepository;

  List<HistoryEntry> entries = [];
  bool isLoading = false;

  /// HistoryStorageService.getAll() already degrades corrupted local data to
  /// `[]` rather than throwing, but this catch is a second, independent
  /// safety net at the provider layer — load() must never surface an
  /// uncaught exception to the UI regardless of what the storage layer does.
  Future<void> load() async {
    isLoading = true;
    notifyListeners();
    try {
      entries = await _historyRepository.getHistory();
    } catch (_) {
      entries = [];
    } finally {
      isLoading = false;
      notifyListeners();
    }
  }
}
