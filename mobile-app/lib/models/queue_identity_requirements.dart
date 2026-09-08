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
    this.restrictionPeriod,
    this.identityMode,
    this.identityFieldKey,
    this.requiresVerifiedPhone = false,
    this.configurationRequired = false,
  });

  /// Whether this queue limits how often one customer may return.
  final bool repeatRestricted;

  /// ONCE_EVER / DAILY / WEEKLY / MONTHLY — null when unrestricted, or when
  /// the queue still needs configuring.
  final String? restrictionPeriod;

  /// VERIFIED_PHONE / CUSTOM_FIELD / VERIFIED_PHONE_AND_CUSTOM_FIELD.
  final String? identityMode;

  /// The form question whose answer identifies the customer, when the queue
  /// uses one. Worth pointing out in the form so the customer understands
  /// why it is being asked and answers it accurately.
  final String? identityFieldKey;

  /// The customer must verify a phone number by SMS before joining.
  final bool requiresVerifiedPhone;

  /// A queue restricted before ADR-034 that has not yet been given an
  /// identity method. The backend refuses joins in this state, so the app
  /// says so instead of letting someone fill in a whole form first.
  final bool configurationRequired;

  factory QueueIdentityRequirements.fromJson(Map<String, dynamic> json) {
    return QueueIdentityRequirements(
      repeatRestricted: json['repeatRestricted'] as bool? ?? false,
      restrictionPeriod: json['restrictionPeriod'] as String?,
      identityMode: json['identityMode'] as String?,
      identityFieldKey: json['identityFieldKey'] as String?,
      requiresVerifiedPhone: json['requiresVerifiedPhone'] as bool? ?? false,
      configurationRequired: json['configurationRequired'] as bool? ?? false,
    );
  }
}
