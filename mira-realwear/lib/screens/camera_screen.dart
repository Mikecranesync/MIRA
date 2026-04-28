import 'dart:typed_data';
import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import '../models/equipment.dart';
import '../services/mira_api_client.dart';
import '../widgets/hud_scaffold.dart';
import '../widgets/wear_hf_button.dart';

/// Equipment identification via camera + MIRA vision API.
///
/// Technician frames the nameplate/QR code, says "CAPTURE" (or taps),
/// MIRA returns an Equipment object which is passed back to the caller.
class CameraScreen extends StatefulWidget {
  final void Function(Equipment) onEquipmentFound;
  const CameraScreen({super.key, required this.onEquipmentFound});

  @override
  State<CameraScreen> createState() => _CameraScreenState();
}

enum _ScanState { preview, capturing, identifying, found, error }

class _CameraScreenState extends State<CameraScreen> {
  CameraController? _cam;
  _ScanState _state = _ScanState.preview;
  Equipment? _found;
  String? _errorMsg;

  @override
  void initState() {
    super.initState();
    _initCamera();
  }

  Future<void> _initCamera() async {
    final cameras = await availableCameras();
    if (cameras.isEmpty) {
      setState(() {
        _state = _ScanState.error;
        _errorMsg = 'No camera available on this device';
      });
      return;
    }
    // Prefer back camera
    final cam = cameras.firstWhere(
      (c) => c.lensDirection == CameraLensDirection.back,
      orElse: () => cameras.first,
    );
    _cam = CameraController(cam, ResolutionPreset.medium,
        enableAudio: false);
    await _cam!.initialize();
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _cam?.dispose();
    super.dispose();
  }

  Future<void> _capture() async {
    if (_cam == null || !_cam!.value.isInitialized) return;
    if (_state != _ScanState.preview) return;

    setState(() => _state = _ScanState.capturing);
    final file = await _cam!.takePicture();
    final bytes = await file.readAsBytes();

    setState(() => _state = _ScanState.identifying);
    final equipment = await MiraApiClient.instance
        .identifyEquipment(Uint8List.fromList(bytes));

    if (!mounted) return;

    if (equipment != null) {
      setState(() {
        _state = _ScanState.found;
        _found = equipment;
      });
      widget.onEquipmentFound(equipment);
    } else {
      setState(() {
        _state = _ScanState.error;
        _errorMsg = 'Could not identify equipment — try a clearer shot of the nameplate';
      });
    }
  }

  void _retry() => setState(() {
        _state = _ScanState.preview;
        _found = null;
        _errorMsg = null;
      });

  @override
  Widget build(BuildContext context) {
    return HudScaffold(
      title: 'IDENTIFY EQUIPMENT',
      voiceHints: _state == _ScanState.preview
          ? const ['CAPTURE', 'GO BACK']
          : _state == _ScanState.found
              ? const ['CONFIRM', 'RETRY']
              : const [],
      body: Row(
        children: [
          // Left — camera preview
          Expanded(
            flex: 6,
            child: _buildPreviewArea(),
          ),
          // Right — status / actions
          Expanded(
            flex: 3,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: _buildActionPanel(),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPreviewArea() {
    if (_cam == null || !_cam!.value.isInitialized) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(color: Color(0xFF1E88E5)),
            SizedBox(height: 12),
            Text('Initializing camera…',
                style: TextStyle(color: Color(0xFF90A4AE), fontSize: 13)),
          ],
        ),
      );
    }

    return Stack(
      fit: StackFit.expand,
      children: [
        CameraPreview(_cam!),
        // Nameplate targeting reticle
        Center(
          child: Container(
            width: 260,
            height: 140,
            decoration: BoxDecoration(
              border: Border.all(color: const Color(0xFF1E88E5), width: 2),
              borderRadius: BorderRadius.circular(4),
            ),
          ),
        ),
        if (_state == _ScanState.capturing ||
            _state == _ScanState.identifying)
          Container(
            color: Colors.black54,
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const CircularProgressIndicator(
                      color: Color(0xFF1E88E5)),
                  const SizedBox(height: 12),
                  Text(
                    _state == _ScanState.capturing
                        ? 'Capturing…'
                        : 'Identifying equipment…',
                    style: const TextStyle(
                        color: Colors.white, fontSize: 14),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildActionPanel() {
    switch (_state) {
      case _ScanState.preview:
        return Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text(
              'Frame the equipment\nnameplate or QR code',
              textAlign: TextAlign.center,
              style: TextStyle(
                  color: Color(0xFF90A4AE),
                  fontSize: 13,
                  height: 1.5),
            ),
            const SizedBox(height: 20),
            WearHfButton(
              voiceCommand: 'CAPTURE',
              onPressed: _capture,
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.camera_alt, size: 20),
                  SizedBox(width: 8),
                  Text('CAPTURE'),
                ],
              ),
            ),
            const SizedBox(height: 12),
            WearHfButton(
              voiceCommand: 'GO BACK',
              backgroundColor: const Color(0xFF37474F),
              padding: const EdgeInsets.symmetric(
                  horizontal: 16, vertical: 10),
              fontSize: 14,
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('GO BACK'),
            ),
          ],
        );

      case _ScanState.capturing:
      case _ScanState.identifying:
        return const Center(
          child: Text(
            'Processing…',
            style: TextStyle(color: Color(0xFF90A4AE), fontSize: 13),
          ),
        );

      case _ScanState.found:
        final eq = _found!;
        return Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('IDENTIFIED',
                style: TextStyle(
                    color: Color(0xFF4CAF50),
                    fontSize: 11,
                    letterSpacing: 1)),
            const SizedBox(height: 8),
            Text(eq.model,
                style: const TextStyle(
                    color: Colors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.w700)),
            Text(eq.manufacturer,
                style: const TextStyle(
                    color: Color(0xFF90A4AE), fontSize: 13)),
            const SizedBox(height: 16),
            WearHfButton(
              voiceCommand: 'CONFIRM',
              backgroundColor: const Color(0xFF2E7D32),
              onPressed: () => Navigator.of(context).pop(_found),
              child: const Text('CONFIRM'),
            ),
            const SizedBox(height: 10),
            WearHfButton(
              voiceCommand: 'RETRY',
              backgroundColor: const Color(0xFF37474F),
              padding: const EdgeInsets.symmetric(
                  horizontal: 16, vertical: 10),
              fontSize: 14,
              onPressed: _retry,
              child: const Text('RETRY'),
            ),
          ],
        );

      case _ScanState.error:
        return Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline,
                color: Color(0xFFEF5350), size: 36),
            const SizedBox(height: 12),
            Text(
              _errorMsg ?? 'Identification failed',
              textAlign: TextAlign.center,
              style: const TextStyle(
                  color: Color(0xFFEF5350), fontSize: 13),
            ),
            const SizedBox(height: 20),
            WearHfButton(
              voiceCommand: 'RETRY',
              onPressed: _retry,
              child: const Text('RETRY'),
            ),
          ],
        );
    }
  }
}
