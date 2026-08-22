import 'package:flutter/foundation.dart';

import '../models/history_entry.dart';
import '../models/live_queue_token.dart';
import '../models/queue_config.dart';
import '../models/service_option.dart';
import '../repositories/device_repository.dart';
import '../repositories/history_repository.dart';
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
  })  : _queueRepository = queueRepository,
        _tokenRepository = tokenRepository,
        _deviceRepository = deviceRepository,
        _historyRepository = historyRepository;

  final QueueRepository _queueRepository;
  final TokenRepository _tokenRepository;
  final DeviceRepository _deviceRepository;
  final HistoryRepository _historyRepository;

  bool isLoadingQueue = false;
  bool isSubmitting = false;
  String? errorMessage;
  QueueConfig? queueConfig;
  ServiceOption? selectedService;
  Map<String, dynamic> formData = {};
  Map<String, String> formErrors = {};
  LiveQueueToken? createdToken;

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

  void selectService(ServiceOption service) {
    selectedService = service;
    formData = {};
    formErrors = {};
    notifyListeners();
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
    final service = selectedService;
    if (config == null || service == null) {
      errorMessage = 'Please select a service before continuing.';
      notifyListeners();
      return false;
    }

    final validation = validateDynamicForm(config.formFields, formData);
    if (!validation.isValid) {
      formErrors = validation.errorsByKey;
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
        serviceId: service.id,
        deviceIdentifier: deviceIdentifier,
        formData: formData,
        idempotencyKey: _pendingIdempotencyKey!,
      );

      await _historyRepository.recordJoin(
        HistoryEntry(
          tokenId: token.id,
          queueId: config.id,
          queueName: config.name,
          serviceId: service.id,
          serviceName: service.serviceName,
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
      default:
        return e.message;
    }
  }

  void reset() {
    isLoadingQueue = false;
    isSubmitting = false;
    errorMessage = null;
    queueConfig = null;
    selectedService = null;
    formData = {};
    formErrors = {};
    createdToken = null;
    _pendingIdempotencyKey = null;
    notifyListeners();
  }
}
