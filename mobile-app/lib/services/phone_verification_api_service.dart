import 'api_client.dart';

/// The challenge the backend has issued. Deliberately carries no code — the
/// code only ever exists in the SMS, and the app has no way to read it back
/// (ADR-034).
class PhoneVerificationChallenge {
  const PhoneVerificationChallenge({
    required this.verificationId,
    required this.expiresAt,
    required this.resendAvailableInSeconds,
  });

  final String verificationId;
  final DateTime expiresAt;
  final int resendAvailableInSeconds;

  factory PhoneVerificationChallenge.fromJson(Map<String, dynamic> json) {
    return PhoneVerificationChallenge(
      verificationId: json['verificationId'] as String,
      expiresAt: DateTime.parse(json['expiresAt'] as String).toLocal(),
      resendAvailableInSeconds: json['resendAvailableInSeconds'] as int? ?? 60,
    );
  }
}

/// Proof that this customer controls the number. Opaque and short-lived: it
/// is signed by the server, carries a fingerprint rather than the number
/// itself, and is only good for the queue it was issued for.
class PhoneVerificationProof {
  const PhoneVerificationProof({required this.value, required this.expiresAt});

  final String value;
  final DateTime expiresAt;

  factory PhoneVerificationProof.fromJson(Map<String, dynamic> json) {
    return PhoneVerificationProof(
      value: json['verificationProof'] as String,
      expiresAt: DateTime.parse(json['expiresAt'] as String).toLocal(),
    );
  }
}

/// POST /api/public/phone-verification/{start,confirm} — public and
/// unauthenticated, like every other customer endpoint.
class PhoneVerificationApiService {
  PhoneVerificationApiService(this._client);

  final ApiClient _client;

  Future<PhoneVerificationChallenge> start({
    required String queueId,
    required String phone,
  }) async {
    final data = await _client.post(
      '/api/public/phone-verification/start',
      body: {'queueId': queueId, 'phone': phone},
    );
    return PhoneVerificationChallenge.fromJson(data);
  }

  Future<PhoneVerificationProof> confirm({
    required String verificationId,
    required String code,
    required String phone,
  }) async {
    final data = await _client.post(
      '/api/public/phone-verification/confirm',
      body: {'verificationId': verificationId, 'code': code, 'phone': phone},
    );
    return PhoneVerificationProof.fromJson(data);
  }
}
