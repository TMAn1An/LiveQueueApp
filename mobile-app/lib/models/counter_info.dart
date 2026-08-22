class CounterInfo {
  const CounterInfo({required this.id, required this.name});

  final String id;
  final String name;

  factory CounterInfo.fromJson(Map<String, dynamic> json) {
    return CounterInfo(id: json['id'] as String, name: json['name'] as String);
  }
}
