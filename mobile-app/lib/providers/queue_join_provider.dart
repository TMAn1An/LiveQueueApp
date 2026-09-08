import 'package:flutter/foundation.dart';

import '../models/history_entry.dart';
import '../models/live_queue_token.dart';
import '../models/queue_config.dart';
import '../models/service_option.dart';
import '../repositories/device_repository.dart';
import '../repositories/history_repository.dart';
import '../repositories/phone_verification_repository.dart';
import '../repositories/queue_repository.dart';
import '../repositories/token_repository.dart';
import '../services/api_exception.dart';
import '../utils/form_validation.dart';
import '../utils/qr_parser.dart';
import '../utils/uuid_generator.dart';

/// Drives the full join flow (spec section 4.3): scan QR -> load queue ->
/// select service -> fill dynamic form -> confirm -> token created. Screens
/// only read state and call these methods; all business logic (QR parsing,
/// device registration, idempotency-key generation, form validation) lives
/// here, not in the widgets (CLAUDE.md Flutter rules).
class QueueJoinProvider extends ChangeNotifier {
  QueueJoinProvider({
    required QueueRepository queueRepository,
    required TokenRepository tokenRepository,
    required DeviceRepository deviceRepository,
    required HistoryRepository historyRepository,
    required PhoneVerificationRepository phoneVerificationRepository,
  })  : _queueRepository = queueRepository,
        _tokenRepository = tokenRepository,
        _deviceRepository = deviceRepository,
        _historyRepository = historyRepository,
        _phoneVerificationRepository = phoneVerificationRepository;

  final QueueRepository _queueRepository;
  final TokenRepository _tokenRepository;
  final DeviceRepository _deviceRepository;
  final HistoryRepository _historyRepository;
  final PhoneVerificationRepository _phoneVerificationRepository;

  bool isLoadingQueue = false;
  bool isSubmitting = false;
  String? errorMessage;
  QueueConfig? queueConfig;
  /// V2 Checkpoint 5 (ADR-027): checkbox-style multi-selection — ids only;
  /// the corresponding [ServiceOption]s are looked up from [queueConfig] on
  /// demand ([selectedServices]) rather than duplicated here, so this never
  /// drifts from the queue's actual service list.
  Set<String> selectedServiceIds = {};
  Map<String, dynamic> formData = {};
  Map<String, String> formErrors = {};
  LiveQueueToken? createdToken;

  /* ---- Phone verification (ADR-034) ------------------------------------
     Only used by queues that recognise customers by a verified number. The
     app holds a server-issued proof, never a "verified" flag of its own:
     claiming verification locally would be worth exactly nothing, since the
     backend re-checks the signature on every join. */

  /// What the customer typed, in international format. Kept so a resend or a
  /// confirm sends the same number the code went to.
  String phoneNumber = '';
  String? _verificationId;
  String? _verificationProof;
  bool isSendingCode = false;
  bool isConfirmingCode = false;

  /// Shown under the phone/code fields, separate from [errorMessage] so a
  /// verification problem does not look like a join failure.
  String? verificationError;

  /// When the customer may ask for another code. Null until one has been
  /// sent; the countdown itself is the screen's business.
  DateTime? resendAvailableAt;

  bool get isAwaitingCode => _verificationId != null && _verificationProof == null;
  bool get isPhoneVerified => _verificationProof != null;

  /// Whether this queue will refuse the join until a number is verified.
  bool get requiresPhoneVerification =>
      queueConfig?.identity.requiresVerifiedPhone ?? false;

  /// The queue limits repeat visits but has not been told how to recognise
  /// customers — the backend refuses every join, so there is no point
  /// walking someone through a form first.
  bool get queueNeedsIdentitySetup =>
      queueConfig?.identity.configurationRequired ?? false;

  /// The form question this queue identifies customers by, if any — the
  /// form screen highlights it so the answer is given accurately.
  String? get identityFieldKey => queueConfig?.identity.identityFieldKey;

  bool get canSubmitJoin => !requiresPhoneVerification || isPhoneVerified;

  List<ServiceOption> get selectedServices {
    final config = queueConfig;
    if (config == null) return const [];
    return config.services.where((s) => selectedServiceIds.contains(s.id)).toList();
  }

  /// UX only — the backend recalculates and is authoritative for the total
  /// used in the actual ETA engine (V2 Checkpoint 5 requirement).
  int get selectedTotalDurationMinutes =>
      selectedServices.fold(0, (sum, s) => sum + s.durationMinutes);

  /// One logical join attempt must use exactly one idempotency key (spec
  /// section 26). Generated lazily on the first submit and reused on every
  /// retry of that same attempt — a request can succeed on the server while
  /// its response is lost in transit, so a retry that generated a *new* key
  /// would look like a brand-new request to the backend and could create a
  /// duplicate token. Cleared only on success or on reset() — never merely
  /// because an HTTP call failed.
  String? _pendingIdempotencyKey;

  Future<void> loadQueueFromScannedQr(String rawQrData) async {
    try {
      final queueId = QrParser.parseQueueId(rawQrData);
      await loadQueueById(queueId);
    } on QrParseException catch (e) {
      errorMessage = e.message;
      notifyListeners();
    }
  }

  Future<void> loadQueueById(String queueId) async {
    isLoadingQueue = true;
    errorMessage = null;
    notifyListeners();

    try {
      queueConfig = await _queueRepository.getQueueConfig(queueId);
    } on ApiException catch (e) {
      errorMessage = e.code == 'QUEUE_NOT_FOUND'
          ? 'This queue could not be found. Please check the QR code and try again.'
          : e.message;
      queueConfig = null;
    } catch (_) {
      errorMessage = 'Unable to load this queue right now. Please try again.';
      queueConfig = null;
    } finally {
      isLoadingQueue = false;
      notifyListeners();
    }
  }

  /// Checkbox toggle — several services may be selected at once (V2
  /// Checkpoint 5). Clearing formData/formErrors on every change mirrors
  /// the previous single-select behavior exactly: the dynamic form is
  /// queue-level, not service-level, but a changed selection means the
  /// customer hasn't seen/confirmed the form for it yet.
  ///
  /// V2 Checkpoint 6: when the loaded queue disallows multiple services,
  /// selecting one replaces the whole set instead of adding to it (radio
  /// behavior) — the backend independently re-validates and is the actual
  /// enforcement point regardless of this client-side shortcut.
  void toggleService(String serviceId) {
    final allowMultiple = queueConfig?.allowMultipleServices ?? true;
    Set<String> updated;
    if (allowMultiple) {
      updated = Set<String>.from(selectedServiceIds);
      if (!updated.remove(serviceId)) {
        updated.add(serviceId);
      }
    } else {
      updated = selectedServiceIds.contains(serviceId) ? {} : {serviceId};
    }
    selectedServiceIds = updated;
    formData = {};
    formErrors = {};
    notifyListeners();
  }

  /// Typing a different number invalidates whatever was verified before —
  /// otherwise someone could verify one number and join with another shown
  /// on screen.
  void updatePhoneNumber(String value) {
    if (value == phoneNumber) return;
    phoneNumber = value;
    _verificationId = null;
    _verificationProof = null;
    verificationError = null;
    resendAvailableAt = null;
    notifyListeners();
  }

  /// Asks the backend to send a code. Also the resend path: the backend
  /// reuses the same challenge, so its cooldown and attempt budget cannot be
  /// reset by asking again.
  Future<bool> sendVerificationCode() async {
    final config = queueConfig;
    if (config == null) return false;
    if (phoneNumber.trim().isEmpty) {
      verificationError = 'Enter your phone number in international format, for example +8801712345678.';
      notifyListeners();
      return false;
    }

    isSendingCode = true;
    verificationError = null;
    notifyListeners();

    try {
      final challenge = await _phoneVerificationRepository.start(
        queueId: config.id,
        phone: phoneNumber.trim(),
      );
      _verificationId = challenge.verificationId;
      _verificationProof = null;
      resendAvailableAt =
          DateTime.now().add(Duration(seconds: challenge.resendAvailableInSeconds));
      return true;
    } on ApiException catch (e) {
      verificationError = _messageForVerificationError(e);
      return false;
    } catch (_) {
      verificationError = 'We could not send the code right now. Please try again.';
      return false;
    } finally {
      isSendingCode = false;
      notifyListeners();
    }
  }

  /// Exchanges the code for the proof the join will carry. The code itself
  /// is never stored — it goes straight to the server and is forgotten.
  Future<bool> confirmVerificationCode(String code) async {
    final verificationId = _verificationId;
    if (verificationId == null) return false;

    isConfirmingCode = true;
    verificationError = null;
    notifyListeners();

    try {
      final proof = await _phoneVerificationRepository.confirm(
        verificationId: verificationId,
        code: code.trim(),
        phone: phoneNumber.trim(),
      );
      _verificationProof = proof.value;
      return true;
    } on ApiException catch (e) {
      verificationError = _messageForVerificationError(e);
      return false;
    } catch (_) {
      verificationError = 'We could not check that code right now. Please try again.';
      return false;
    } finally {
      isConfirmingCode = false;
      notifyListeners();
    }
  }

  String _messageForVerificationError(ApiException e) {
    switch (e.code) {
      case 'INVALID_PHONE_NUMBER':
        return 'Enter your phone number in international format, for example +8801712345678.';
      case 'VERIFICATION_CODE_INCORRECT':
        return 'That code is not correct. Please check and try again.';
      case 'VERIFICATION_INVALID_OR_EXPIRED':
        return 'That code has expired. Please request a new one.';
      case 'VERIFICATION_ATTEMPTS_EXCEEDED':
        return 'Too many incorrect attempts. Please request a new code.';
      case 'VERIFICATION_RESEND_TOO_SOON':
        return e.message;
      case 'VERIFICATION_PHONE_MISMATCH':
        return 'That code was sent to a different number. Please request a new one.';
      case 'PHONE_VERIFICATION_UNAVAILABLE':
        return 'Phone verification is unavailable right now. Please try again later.';
      case 'PHONE_VERIFICATION_NOT_REQUIRED':
        return 'This queue does not ask for a verified phone number.';
      default:
        return e.message;
    }
  }

  void updateFormField(String key, dynamic value) {
    formData = {...formData, key: value};
    if (formErrors.containsKey(key)) {
      formErrors = {...formErrors}..remove(key);
    }
    notifyListeners();
  }

  /// Returns true if the token was created successfully. On failure, the
  /// screen should read [errorMessage] (and [formErrors] for validation
  /// failures) and re-render rather than navigate forward.
  Future<bool> submitJoin() async {
    final config = queueConfig;
    final services = selectedServices;
    if (config == null || services.isEmpty) {
      errorMessage = 'Please select at least one service before continuing.';
      notifyListeners();
      return false;
    }

    final validation = validateDynamicForm(config.formFields, formData);
    if (!validation.isValid) {
      formErrors = validation.errorsByKey;
      notifyListeners();
      return false;
    }

    // Checked here as well as in the UI: the backend rejects an unverified
    // join anyway, and saying so before the request is a better experience
    // than a round trip that can only fail.
    if (requiresPhoneVerification && !isPhoneVerified) {
      errorMessage = 'Please verify your phone number before joining.';
      notifyListeners();
      return false;
    }

    isSubmitting = true;
    errorMessage = null;
    notifyListeners();

    try {
      final deviceIdentifier = await _deviceRepository.ensureRegisteredDevice();
      _pendingIdempotencyKey ??= generateUuidV4();
      final token = await _tokenRepository.createToken(
        queueId: config.id,
        serviceIds: services.map((s) => s.id).toList(),
        deviceIdentifier: deviceIdentifier,
        formData: formData,
        idempotencyKey: _pendingIdempotencyKey!,
        phoneVerificationProof: _verificationProof,
      );

      await _historyRepository.recordJoin(
        HistoryEntry(
          tokenId: token.id,
          queueId: config.id,
          queueName: config.name,
          serviceId: services.first.id,
          serviceName: services.first.serviceName,
          additionalServiceNames: services.skip(1).map((s) => s.serviceName).toList(),
          serialNumber: token.serialNumber,
          createdAt: token.createdAt,
          finalStatus: token.status,
        ),
      );

      createdToken = token;
      // Only cleared on success — a failed attempt keeps the same key
      // pending so the next retry reuses it (see field doc above).
      _pendingIdempotencyKey = null;
      return true;
    } on ApiException catch (e) {
      errorMessage = _messageForJoinError(e);
      return false;
    } catch (_) {
      errorMessage = 'Unable to join this queue right now. Please try again.';
      return false;
    } finally {
      isSubmitting = false;
      notifyListeners();
    }
  }

  String _messageForJoinError(ApiException e) {
    switch (e.code) {
      case 'QUEUE_NOT_ACTIVE':
        return 'This queue is not currently accepting new customers.';
      case 'QUEUE_ARCHIVED':
        return 'This queue is no longer available.';
      case 'SERVICE_NOT_ACTIVE':
        return 'This service is no longer available. Please choose another.';
      case 'DEVICE_BLOCKED':
        return 'This device is not able to join queues. Please contact staff.';
      case 'IDEMPOTENCY_KEY_CONFLICT':
        return 'This request could not be completed. Please try again.';
      case 'REPEAT_VISIT_NOT_ALLOWED':
        return _repeatVisitMessage(e);
      case 'QUEUE_IDENTITY_CONFIGURATION_REQUIRED':
        return 'This queue is not accepting customers yet. Please contact staff.';
      case 'PHONE_VERIFICATION_REQUIRED':
        return 'Please verify your phone number before joining.';
      case 'PHONE_VERIFICATION_INVALID':
        return 'Your phone verification has expired. Please verify your number again.';
      case 'IDENTITY_VALUE_REQUIRED':
        return 'Please answer the question that identifies you for this queue.';
      case 'MULTIPLE_SERVICES_NOT_ALLOWED':
        return 'This queue only allows selecting a single service.';
      default:
        return e.message;
    }
  }

  /// The refusal is about the *person*, not this phone, so it must never
  /// suggest the device is blocked — and it says when they may come back
  /// where the queue's period makes that knowable (ADR-034; the backend
  /// sends the period, never anything identifying).
  String _repeatVisitMessage(ApiException e) {
    switch (e.details['restrictionPeriod'] as String?) {
      case 'DAILY':
        return 'You have already used this queue today. Please come back tomorrow.';
      case 'WEEKLY':
        return 'You have already used this queue this week.';
      case 'MONTHLY':
        return 'You have already used this queue this month.';
      case 'ONCE_EVER':
        return 'You have already used this queue, and it can only be used once.';
      default:
        return e.message;
    }
  }

  void reset() {
    isLoadingQueue = false;
    isSubmitting = false;
    errorMessage = null;
    queueConfig = null;
    selectedServiceIds = {};
    formData = {};
    formErrors = {};
    createdToken = null;
    _pendingIdempotencyKey = null;
    phoneNumber = '';
    _verificationId = null;
    _verificationProof = null;
    isSendingCode = false;
    isConfirmingCode = false;
    verificationError = null;
    resendAvailableAt = null;
    notifyListeners();
  }
}
