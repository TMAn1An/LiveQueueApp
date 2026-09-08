import '../services/phone_verification_api_service.dart';

/// Thin pass-through today, kept for the same reason every other repository
/// here exists: screens and providers talk to repositories, never to an API
/// service directly, so a future change of transport stays in one place.
class PhoneVerificationRepository {
  PhoneVerificationRepository({required PhoneVerificationApiService apiService})
      : _apiService = apiService;

  final PhoneVerificationApiService _apiService;

  Future<PhoneVerificationChallenge> start({
    required String queueId,
    required String phone,
  }) {
    return _apiService.start(queueId: queueId, phone: phone);
  }

  Future<PhoneVerificationProof> confirm({
    required String verificationId,
    required String code,
    required String phone,
  }) {
    return _apiService.confirm(verificationId: verificationId, code: code, phone: phone);
  }
}
