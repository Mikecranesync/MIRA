import 'package:flutter/material.dart';
import '../models/equipment.dart';
import '../models/work_order.dart';
import '../services/mira_api_client.dart';
import '../services/voice_service.dart';
import '../widgets/hud_scaffold.dart';
import '../widgets/wear_hf_button.dart';

/// Voice-driven work order creation screen.
///
/// Flow: Technician voice-fills title → description → priority → confirms.
/// Each field is filled by saying "RECORD [FIELD]", speaking, then "DONE".
class WorkOrderScreen extends StatefulWidget {
  final Equipment? equipment;
  const WorkOrderScreen({super.key, this.equipment});

  @override
  State<WorkOrderScreen> createState() => _WorkOrderScreenState();
}

enum _WoField { title, description, priority, confirm }

class _WorkOrderScreenState extends State<WorkOrderScreen> {
  String _title = '';
  String _description = '';
  WoPriority _priority = WoPriority.medium;
  _WoField _activeField = _WoField.title;
  bool _recording = false;
  bool _submitting = false;
  bool _submitted = false;
  String? _errorMsg;

  Future<void> _record(_WoField field) async {
    if (_recording || _submitting) return;
    setState(() {
      _activeField = field;
      _recording = true;
      _errorMsg = null;
    });
    await VoiceService.instance.startRecording();
  }

  Future<void> _stopRecord() async {
    if (!_recording) return;
    setState(() => _recording = false);
    final text = await VoiceService.instance.stopAndTranscribe();
    if (text.isEmpty) return;

    setState(() {
      switch (_activeField) {
        case _WoField.title:
          _title = text;
        case _WoField.description:
          _description = text;
        case _WoField.priority:
          _priority = _parsePriority(text);
        case _WoField.confirm:
          break;
      }
    });
  }

  WoPriority _parsePriority(String spoken) {
    final s = spoken.toLowerCase();
    if (s.contains('critical') || s.contains('urgent')) {
      return WoPriority.critical;
    } else if (s.contains('high')) {
      return WoPriority.high;
    } else if (s.contains('low')) {
      return WoPriority.low;
    }
    return WoPriority.medium;
  }

  Future<void> _submit() async {
    if (_title.isEmpty) {
      setState(() => _errorMsg = 'Title is required — say "RECORD TITLE" first');
      return;
    }
    setState(() {
      _submitting = true;
      _errorMsg = null;
    });

    final wo = WorkOrder(
      title: _title,
      description: _description,
      priority: _priority,
      assetId: widget.equipment?.id,
      assetName: widget.equipment?.name,
    );

    final ok = await MiraApiClient.instance.createWorkOrder(wo);
    if (!mounted) return;

    if (ok) {
      setState(() => _submitted = true);
      await VoiceService.instance
          .speak('Work order created. Priority: ${_priority.name}.');
    } else {
      setState(() {
        _submitting = false;
        _errorMsg = 'Submit failed — check connection and retry';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_submitted) return _SuccessView(priority: _priority);

    return HudScaffold(
      title: 'CREATE WORK ORDER',
      voiceHints: _recording
          ? const ['DONE']
          : const [
              'RECORD TITLE',
              'RECORD DESCRIPTION',
              'SET PRIORITY',
              'SUBMIT',
            ],
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Left — form fields preview
            Expanded(
              flex: 6,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (widget.equipment != null)
                    _FieldRow('ASSET',
                        '${widget.equipment!.model} (${widget.equipment!.id})'),
                  _FieldRow('TITLE', _title.isEmpty ? '—' : _title,
                      highlight: _activeField == _WoField.title && _recording),
                  _FieldRow(
                      'DESCRIPTION',
                      _description.isEmpty ? '—' : _description,
                      highlight:
                          _activeField == _WoField.description && _recording),
                  _FieldRow('PRIORITY', _priority.name.toUpperCase(),
                      highlight: _activeField == _WoField.priority && _recording,
                      priorityColor: _priorityColor(_priority)),
                  if (_errorMsg != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: Text(
                        _errorMsg!,
                        style: const TextStyle(
                            color: Color(0xFFEF5350), fontSize: 13),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            // Right — voice action buttons
            SizedBox(
              width: 180,
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  if (_recording)
                    WearHfButton(
                      voiceCommand: 'DONE',
                      backgroundColor: const Color(0xFFD32F2F),
                      onPressed: _stopRecord,
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.stop, size: 18),
                          SizedBox(width: 6),
                          Text('DONE'),
                        ],
                      ),
                    )
                  else ...[
                    _VoiceFieldButton(
                      command: 'RECORD TITLE',
                      icon: Icons.title,
                      onPressed: () => _record(_WoField.title),
                    ),
                    const SizedBox(height: 8),
                    _VoiceFieldButton(
                      command: 'RECORD DESCRIPTION',
                      icon: Icons.description,
                      onPressed: () => _record(_WoField.description),
                    ),
                    const SizedBox(height: 8),
                    _VoiceFieldButton(
                      command: 'SET PRIORITY',
                      icon: Icons.flag,
                      onPressed: () => _record(_WoField.priority),
                    ),
                    const SizedBox(height: 16),
                    WearHfButton(
                      voiceCommand: 'SUBMIT',
                      backgroundColor: const Color(0xFFE65100),
                      onPressed: _submitting ? null : _submit,
                      child: _submitting
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(
                                  color: Colors.white, strokeWidth: 2),
                            )
                          : const Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(Icons.send, size: 18),
                                SizedBox(width: 6),
                                Text('SUBMIT'),
                              ],
                            ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Color _priorityColor(WoPriority p) {
    switch (p) {
      case WoPriority.critical:
        return const Color(0xFFD32F2F);
      case WoPriority.high:
        return const Color(0xFFE65100);
      case WoPriority.medium:
        return const Color(0xFFF9A825);
      case WoPriority.low:
        return const Color(0xFF2E7D32);
    }
  }
}

class _FieldRow extends StatelessWidget {
  final String label;
  final String value;
  final bool highlight;
  final Color? priorityColor;

  const _FieldRow(this.label, this.value,
      {this.highlight = false, this.priorityColor});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: highlight
            ? const Color(0xFF1A2744)
            : const Color(0xFF0D1117),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(
          color: highlight
              ? const Color(0xFF1E88E5)
              : const Color(0xFF1A2335),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 110,
            child: Text(
              label,
              style: const TextStyle(
                color: Color(0xFF90A4AE),
                fontSize: 11,
                letterSpacing: 0.8,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                color: priorityColor ?? Colors.white,
                fontSize: 14,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _VoiceFieldButton extends StatelessWidget {
  final String command;
  final IconData icon;
  final VoidCallback onPressed;

  const _VoiceFieldButton({
    required this.command,
    required this.icon,
    required this.onPressed,
  });

  @override
  Widget build(BuildContext context) {
    return WearHfButton(
      voiceCommand: command,
      backgroundColor: const Color(0xFF263238),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      fontSize: 13,
      onPressed: onPressed,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16),
          const SizedBox(width: 6),
          Flexible(child: Text(command, overflow: TextOverflow.ellipsis)),
        ],
      ),
    );
  }
}

class _SuccessView extends StatelessWidget {
  final WoPriority priority;
  const _SuccessView({required this.priority});

  @override
  Widget build(BuildContext context) {
    return HudScaffold(
      title: 'WORK ORDER CREATED',
      voiceHints: const ['GO BACK'],
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.check_circle,
                size: 56, color: Color(0xFF4CAF50)),
            const SizedBox(height: 16),
            const Text(
              'Work Order Submitted',
              style: TextStyle(
                  color: Colors.white,
                  fontSize: 20,
                  fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Text(
              'Priority: ${priority.name.toUpperCase()}',
              style: const TextStyle(
                  color: Color(0xFF90A4AE), fontSize: 14),
            ),
            const SizedBox(height: 24),
            WearHfButton(
              voiceCommand: 'GO BACK',
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('GO BACK'),
            ),
          ],
        ),
      ),
    );
  }
}
