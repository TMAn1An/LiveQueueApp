import '../services/email_verification_api_service.dart';

/// Thin pass-through today, kept for the same reason every other repository
/// here exists: screens and providers talk to repositories, never to an API
/// service directly, so a future change of transport stays in one place.
class EmailVerificationRepository {
  EmailVerificationRepository({required EmailVerificationApiService apiService})
      : _apiService = apiService;

  final EmailVerificationApiService _apiService;

  Future<EmailVerificationChallenge> start({
    required String queueId,
    required String email,
  }) {
    return _apiService.start(queueId: queueId, email: email);
  }

  Future<EmailVerificationProof> confirm({
    required String verificationId,
    required String code,
    required String email,
  }) {
    return _apiService.confirm(verificationId: verificationId, code: code, email: email);
  }
}
