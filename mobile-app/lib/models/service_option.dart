class ServiceOption {
  const ServiceOption({
    required this.id,
    required this.serviceName,
    required this.durationMinutes,
    this.description,
    this.maxOccurrencesPerJourney = 2,
  });

  final String id;
  final String serviceName;
  final String? description;
  final int durationMinutes;

  /// ADR-070: how often one visit may include this service (never twice in
  /// a row). 2 from a backend that predates the field.
  final int maxOccurrencesPerJourney;

  factory ServiceOption.fromJson(Map<String, dynamic> json) {
    return ServiceOption(
      id: json['id'] as String,
      serviceName: json['serviceName'] as String,
      description: json['description'] as String?,
      durationMinutes: json['durationMinutes'] as int,
      maxOccurrencesPerJourney: json['maxOccurrencesPerJourney'] as int? ?? 2,
    );
  }
}
