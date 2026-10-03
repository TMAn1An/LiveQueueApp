import '../models/organization_directory.dart';
import '../models/queue_config.dart';
import '../services/queue_api_service.dart';

class QueueRepository {
  QueueRepository({required QueueApiService apiService}) : _apiService = apiService;

  final QueueApiService _apiService;

  Future<QueueConfig> getQueueConfig(String queueId) {
    return _apiService.getPublicQueueConfig(queueId);
  }

  Future<OrganizationDirectory> getOrganization(String publicCode) {
    return _apiService.getPublicOrganization(publicCode);
  }
}
