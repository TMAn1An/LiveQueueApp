class ServiceOption {
  const ServiceOption({
    required this.id,
    required this.serviceName,
    required this.durationMinutes,
    this.description,
  });

  final String id;
  final String serviceName;
  final String? description;
  final int durationMinutes;

  factory ServiceOption.fromJson(Map<String, dynamic> json) {
    return ServiceOption(
      id: json['id'] as String,
      serviceName: json['serviceName'] as String,
      description: json['description'] as String?,
      durationMinutes: json['durationMinutes'] as int,
    );
  }
}
