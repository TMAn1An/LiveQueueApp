import 'api_client.dart';

/// The challenge the backend has issued. Deliberately carries no code — the
/// code only ever exists in the customer's inbox, and the app has no way to
/// read it back (ADR-037).
class EmailVerificationChallenge {
  const EmailVerificationChallenge({
    required this.verificationId,
    required this.expiresAt,
    required this.resendAvailableInSeconds,
  });

  final String verificationId;
  final DateTime expiresAt;
  final int resendAvailableInSeconds;

  factory EmailVerificationChallenge.fromJson(Map<String, dynamic> json) {
    return EmailVerificationChallenge(
      verificationId: json['verificationId'] as String,
      expiresAt: DateTime.parse(json['expiresAt'] as String).toLocal(),
      resendAvailableInSeconds: json['resendAvailableInSeconds'] as int? ?? 60,
    );
  }
}

/// Proof that this customer can read the mailbox. Opaque and short-lived: it
/// is signed by the server, carries a fingerprint rather than the address
/// itself, and is only good for the queue it was issued for.
class EmailVerificationProof {
  const EmailVerificationProof({required this.value, required this.expiresAt});

  final String value;
  final DateTime expiresAt;

  factory EmailVerificationProof.fromJson(Map<String, dynamic> json) {
    return EmailVerificationProof(
      value: json['verificationProof'] as String,
      expiresAt: DateTime.parse(json['expiresAt'] as String).toLocal(),
    );
  }
}

/// POST /api/public/email-verification/{start,confirm} — public and
/// unauthenticated, like every other customer endpoint.
class EmailVerificationApiService {
  EmailVerificationApiService(this._client);

  final ApiClient _client;

  Future<EmailVerificationChallenge> start({
    required String queueId,
    required String email,
  }) async {
    final data = await _client.post(
      '/api/public/email-verification/start',
      body: {'queueId': queueId, 'email': email},
    );
    return EmailVerificationChallenge.fromJson(data);
  }

  Future<EmailVerificationProof> confirm({
    required String verificationId,
    required String code,
    required String email,
  }) async {
    final data = await _client.post(
      '/api/public/email-verification/confirm',
      body: {'verificationId': verificationId, 'code': code, 'email': email},
    );
    return EmailVerificationProof.fromJson(data);
  }
}
