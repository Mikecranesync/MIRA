import 'package:flutter/material.dart';
import '../models/equipment.dart';
import '../widgets/hud_scaffold.dart';
import '../widgets/wear_hf_button.dart';
import 'camera_screen.dart';
import 'chat_screen.dart';
import 'work_order_screen.dart';

/// Main dashboard — shown after login.
///
/// Displays currently identified equipment context (if any) and
/// provides navigation to all other screens via voice commands.
class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  Equipment? _equipment;

  void _setEquipment(Equipment eq) => setState(() => _equipment = eq);

  void _navigate(Widget screen) {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => screen),
    );
  }

  @override
  Widget build(BuildContext context) {
    return HudScaffold(
      title: 'DASHBOARD',
      voiceHints: const ['IDENTIFY EQUIPMENT', 'ASK MIRA', 'CREATE WORK ORDER'],
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Left — equipment context panel
            Expanded(
              flex: 5,
              child: _EquipmentPanel(equipment: _equipment),
            ),
            const SizedBox(width: 16),
            // Right — action buttons
            Expanded(
              flex: 4,
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  WearHfButton(
                    voiceCommand: 'IDENTIFY EQUIPMENT',
                    onPressed: () async {
                      final eq = await Navigator.of(context).push<Equipment>(
                        MaterialPageRoute(
                          builder: (_) => CameraScreen(onEquipmentFound: _setEquipment),
                        ),
                      );
                      if (eq != null) _setEquipment(eq);
                    },
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.camera_alt, size: 20),
                        SizedBox(width: 8),
                        Text('IDENTIFY EQUIPMENT'),
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),
                  WearHfButton(
                    voiceCommand: 'ASK MIRA',
                    backgroundColor: const Color(0xFF2E7D32),
                    onPressed: () => _navigate(
                      ChatScreen(equipment: _equipment),
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.mic, size: 20),
                        SizedBox(width: 8),
                        Text('ASK MIRA'),
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),
                  WearHfButton(
                    voiceCommand: 'CREATE WORK ORDER',
                    backgroundColor: const Color(0xFFE65100),
                    onPressed: () => _navigate(
                      WorkOrderScreen(equipment: _equipment),
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.assignment_add, size: 20),
                        SizedBox(width: 8),
                        Text('CREATE WORK ORDER'),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EquipmentPanel extends StatelessWidget {
  final Equipment? equipment;
  const _EquipmentPanel({required this.equipment});

  @override
  Widget build(BuildContext context) {
    if (equipment == null) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.precision_manufacturing,
                size: 48, color: Color(0xFF37474F)),
            SizedBox(height: 12),
            Text(
              'No equipment identified',
              style: TextStyle(color: Color(0xFF546E7A), fontSize: 16),
            ),
            SizedBox(height: 4),
            Text(
              'Say "IDENTIFY EQUIPMENT" to scan',
              style: TextStyle(color: Color(0xFF37474F), fontSize: 13),
            ),
          ],
        ),
      );
    }

    final eq = equipment!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _InfoRow('TYPE', eq.equipmentType),
        _InfoRow('MANUFACTURER', eq.manufacturer),
        _InfoRow('MODEL', eq.model),
        _InfoRow('ASSET ID', eq.id),
        if (eq.tags.isNotEmpty) ...[
          const SizedBox(height: 8),
          const Text(
            'LIVE TAGS',
            style: TextStyle(color: Color(0xFF90A4AE), fontSize: 11,
                letterSpacing: 1),
          ),
          const SizedBox(height: 4),
          ...eq.tags.entries.take(4).map(
                (e) => _InfoRow(e.key.toUpperCase(), '${e.value}'),
              ),
        ],
      ],
    );
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;
  const _InfoRow(this.label, this.value);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 120,
            child: Text(
              label,
              style: const TextStyle(
                color: Color(0xFF90A4AE),
                fontSize: 12,
                letterSpacing: 0.8,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 15,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
