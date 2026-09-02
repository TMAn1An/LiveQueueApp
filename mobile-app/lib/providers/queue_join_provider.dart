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
  /// V2 Checkpoint 5 (ADR-027): checkbox-style multi-selection — ids only;
  /// the corresponding [ServiceOption]s are looked up from [queueConfig] on
  /// demand ([selectedServices]) rather than duplicated here, so this never
  /// drifts from the queue's actual service list.
  Set<String> selectedServiceIds = {};
  Map<String, dynamic> formData = {};
  Map<String, String> formErrors = {};
  LiveQueueToken? createdToken;

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
        return 'You have already completed a visit to this queue. Repeat visits are not allowed.';
      case 'MULTIPLE_SERVICES_NOT_ALLOWED':
        return 'This queue only allows selecting a single service.';
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
    notifyListeners();
  }
}
