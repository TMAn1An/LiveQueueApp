import '../models/live_queue_token.dart';
import '../models/service_start_verification_code.dart';
import 'api_client.dart';

/// Wraps the Phase 3 public token endpoints. Token creation always carries
/// an Idempotency-Key header (spec section 26) so a retried request after a
/// dropped response never creates a duplicate token.
class TokenApiService {
  TokenApiService(this._client);

  final ApiClient _client;

  /// V2 Checkpoint 5 (ADR-027): always sends the new `serviceIds` shape —
  /// this IS the updated client. The backend also still accepts the legacy
  /// singular `serviceId` for any not-yet-updated install, but a build from
  /// this source always uses the array form.
  Future<LiveQueueToken> createToken({
    required String queueId,
    required List<String> serviceIds,
    required String deviceIdentifier,
    required Map<String, dynamic> formData,
    required String idempotencyKey,
  }) async {
    final data = await _client.post(
      '/api/tokens',
      headers: {'Idempotency-Key': idempotencyKey},
      body: {
        'queueId': queueId,
        'serviceIds': serviceIds,
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

  /// V2 Checkpoint 7 (ADR-029): customer cancellation — ownership is proven
  /// by deviceIdentifier, the same self-asserted identifier every other
  /// customer write in this app already sends (there is no device auth).
  Future<LiveQueueToken> cancelToken(String tokenId, String deviceIdentifier) async {
    final data = await _client.post(
      '/api/tokens/$tokenId/cancel',
      body: {'deviceIdentifier': deviceIdentifier},
    );
    return LiveQueueToken.fromJson(data);
  }

  /// The ONLY call in the app that can return the raw verification code —
  /// never regenerates on a plain read (backend section 23).
  Future<ServiceStartVerificationCode> getVerificationCode(String tokenId, String deviceIdentifier) async {
    final data = await _client.get(
      '/api/tokens/$tokenId/verification-code?deviceIdentifier=${Uri.encodeQueryComponent(deviceIdentifier)}',
    );
    return ServiceStartVerificationCode.fromJson(data);
  }

  /// Smallest safe renewal path for a code the customer missed or that
  /// expired — always mints a fresh code, invalidating whatever was there.
  Future<ServiceStartVerificationCode> reissueVerificationCode(String tokenId, String deviceIdentifier) async {
    final data = await _client.post(
      '/api/tokens/$tokenId/verification-code/reissue',
      body: {'deviceIdentifier': deviceIdentifier},
    );
    return ServiceStartVerificationCode.fromJson(data);
  }
}
