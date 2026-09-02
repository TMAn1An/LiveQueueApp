/// V2 Checkpoint 7 (ADR-029) — the customer's own read of the current
/// CALLED -> IN_PROGRESS verification code (GET/POST reissue
/// .../verification-code). The raw code is customer-only information; this
/// is the ONLY model in the app that ever carries it.
class ServiceStartVerificationCode {
  const ServiceStartVerificationCode({required this.code, required this.expiresAt});

  final String code;
  final DateTime expiresAt;

  factory ServiceStartVerificationCode.fromJson(Map<String, dynamic> json) {
    return ServiceStartVerificationCode(
      code: json['code'] as String,
      expiresAt: DateTime.parse(json['expiresAt'] as String),
    );
  }
}
