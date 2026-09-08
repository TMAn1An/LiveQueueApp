/// What a queue asks for before it will let someone join, when it limits
/// repeat visits (ADR-034).
///
/// The old rule recognised the *installation*, so it could not be shown
/// before joining — the app had no way to know whether this phone had
/// already been served. The rule now recognises the *person*, which is
/// something the customer can be asked about up front, so the backend
/// publishes the shape of the requirement here. It never says who has
/// already visited.
class QueueIdentityRequirements {
  const QueueIdentityRequirements({
    this.repeatRestricted = false,
    this.restrictionType,
    this.restrictionAmount,
    this.restrictionUnit,
    this.restrictionUntil,
    this.identityMode,
    this.identityFieldKey,
    this.requiresVerifiedPhone = false,
    this.requiresVerifiedEmail = false,
    this.configurationRequired = false,
  });

  /// Whether this queue limits how often one customer may return.
  final bool repeatRestricted;

  /// ONCE_EVER / DURATION / UNTIL_DATETIME — null when unrestricted, or when
  /// the queue still needs configuring (ADR-035).
  final String? restrictionType;

  /// For a DURATION window: how long, and in what unit (MINUTE…YEAR).
  final int? restrictionAmount;
  final String? restrictionUnit;

  /// For an UNTIL_DATETIME window: the shared cutoff instant.
  final DateTime? restrictionUntil;

  /// VERIFIED_PHONE / CUSTOM_FIELD / VERIFIED_PHONE_AND_CUSTOM_FIELD.
  final String? identityMode;

  /// The form question whose answer identifies the customer, when the queue
  /// uses one. Worth pointing out in the form so the customer understands
  /// why it is being asked and answers it accurately.
  final String? identityFieldKey;

  /// The customer must verify a phone number by SMS before joining.
  final bool requiresVerifiedPhone;

  /// ADR-037: the customer must prove access to an email address before
  /// joining. Replaces the phone requirement, which is deferred.
  final bool requiresVerifiedEmail;

  /// A queue restricted before ADR-034 that has not yet been given an
  /// identity method. The backend refuses joins in this state, so the app
  /// says so instead of letting someone fill in a whole form first.
  final bool configurationRequired;

  factory QueueIdentityRequirements.fromJson(Map<String, dynamic> json) {
    return QueueIdentityRequirements(
      repeatRestricted: json['repeatRestricted'] as bool? ?? false,
      restrictionType: json['restrictionType'] as String?,
      restrictionAmount: json['restrictionAmount'] as int?,
      restrictionUnit: json['restrictionUnit'] as String?,
      restrictionUntil: json['restrictionUntil'] == null
          ? null
          : DateTime.parse(json['restrictionUntil'] as String),
      identityMode: json['identityMode'] as String?,
      identityFieldKey: json['identityFieldKey'] as String?,
      requiresVerifiedPhone: json['requiresVerifiedPhone'] as bool? ?? false,
      requiresVerifiedEmail: json['requiresVerifiedEmail'] as bool? ?? false,
      configurationRequired: json['configurationRequired'] as bool? ?? false,
    );
  }
}
