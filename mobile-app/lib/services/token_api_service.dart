import '../models/live_queue_token.dart';
import 'api_client.dart';

/// Wraps the Phase 3 public token endpoints. Token creation always carries
/// an Idempotency-Key header (spec section 26) so a retried request after a
/// dropped response never creates a duplicate token.
class TokenApiService {
  TokenApiService(this._client);

  final ApiClient _client;

  Future<LiveQueueToken> createToken({
    required String queueId,
    required String serviceId,
    required String deviceIdentifier,
    required Map<String, dynamic> formData,
    required String idempotencyKey,
  }) async {
    final data = await _client.post(
      '/api/tokens',
      headers: {'Idempotency-Key': idempotencyKey},
      body: {
        'queueId': queueId,
        'serviceId': serviceId,
        'deviceIdentifier': deviceIdentifier,
        'formData': formData,
      },
    );
    return LiveQueueToken.fromJson(data);
  }

  Future<LiveQueueToken> getToken(String tokenId) async {
    final data = await _client.get('/api/tokens/$tokenId');
    return LiveQueueToken.fromJson(data);
  }

  Future<TokenStatusSnapshot> getTokenStatus(String tokenId) async {
    final data = await _client.get('/api/tokens/$tokenId/status');
    return TokenStatusSnapshot.fromJson(data);
  }
}
