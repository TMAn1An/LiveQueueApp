import '../models/notification_preferences.dart';
import '../services/preferences_storage_service.dart';

class NotificationPreferencesRepository {
  NotificationPreferencesRepository({required PreferencesStorageService storageService})
      : _storageService = storageService;

  final PreferencesStorageService _storageService;

  Future<NotificationPreferences> load() => _storageService.load();

  Future<void> save(NotificationPreferences preferences) => _storageService.save(preferences);
}
