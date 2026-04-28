class Equipment {
  final String id;
  final String name;
  final String manufacturer;
  final String model;
  final String equipmentType;
  final Map<String, dynamic> tags; // live Ignition tag values

  const Equipment({
    required this.id,
    required this.name,
    required this.manufacturer,
    required this.model,
    required this.equipmentType,
    this.tags = const {},
  });

  factory Equipment.fromJson(Map<String, dynamic> json) => Equipment(
        id: json['id'] as String? ?? '',
        name: json['name'] as String? ?? 'Unknown',
        manufacturer: json['manufacturer'] as String? ?? '',
        model: json['model'] as String? ?? '',
        equipmentType: json['equipment_type'] as String? ?? '',
        tags: (json['tags'] as Map<String, dynamic>?) ?? {},
      );
}
