enum WoPriority { low, medium, high, critical }

class WorkOrder {
  final String? id;
  final String title;
  final String assetId;
  final String description;
  final WoPriority priority;
  final String status;

  const WorkOrder({
    this.id,
    required this.title,
    required this.assetId,
    required this.description,
    required this.priority,
    this.status = 'open',
  });

  Map<String, dynamic> toJson() => {
        'title': title,
        'asset_id': assetId,
        'description': description,
        'priority': priority.name,
        'status': status,
      };

  factory WorkOrder.fromJson(Map<String, dynamic> json) => WorkOrder(
        id: json['id'] as String?,
        title: json['title'] as String? ?? '',
        assetId: json['asset_id'] as String? ?? '',
        description: json['description'] as String? ?? '',
        priority: WoPriority.values.firstWhere(
          (p) => p.name == json['priority'],
          orElse: () => WoPriority.medium,
        ),
        status: json['status'] as String? ?? 'open',
      );
}
