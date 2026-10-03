import '../models/organization_directory.dart';
import '../models/queue_config.dart';
import 'api_client.dart';

/// GET /api/public/queues/:queueId/config (spec section 7.16) — no auth,
/// no client-supplied organization id involved at all; the queue id is the
/// only input, exactly as scanned from the QR code.
///
/// GET /api/public/organizations/:publicCode (ADR-068) — the organization's
/// one QR code: its public code is the only input, and the backend returns
/// only the queues it lists publicly.
class QueueApiService {
  QueueApiService(this._client);

  final ApiClient _client;

  Future<QueueConfig> getPublicQueueConfig(String queueId) async {
    final data = await _client.get('/api/public/queues/$queueId/config');
    return QueueConfig.fromJson(data);
  }

  Future<OrganizationDirectory> getPublicOrganization(String publicCode) async {
    final data = await _client.get('/api/public/organizations/${Uri.encodeComponent(publicCode)}');
    return OrganizationDirectory.fromJson(data);
  }
}
