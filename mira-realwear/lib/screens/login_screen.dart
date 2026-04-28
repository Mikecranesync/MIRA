import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../services/mira_api_client.dart';
import '../widgets/hud_scaffold.dart';
import 'dashboard_screen.dart';

/// QR-code login screen.
///
/// The Hub generates a one-time QR code at Settings → Connect Device.
/// Technician says "SCAN" or points camera at the QR code — the MobileScanner
/// captures it and exchanges the code for a session token.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final MobileScannerController _scanner = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
    facing: CameraFacing.back,
    torchEnabled: false,
  );

  bool _scanning = true;
  String _statusMessage = 'Point camera at MIRA login QR code';

  @override
  void dispose() {
    _scanner.dispose();
    super.dispose();
  }

  Future<void> _handleBarcode(BarcodeCapture capture) async {
    if (!_scanning) return;
    final code = capture.barcodes.firstOrNull?.rawValue;
    if (code == null) return;

    setState(() {
      _scanning = false;
      _statusMessage = 'Authenticating…';
    });

    final ok = await MiraApiClient.instance.loginWithQrCode(code);
    if (!mounted) return;

    if (ok) {
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => const DashboardScreen()),
      );
    } else {
      setState(() {
        _scanning = true;
        _statusMessage = 'Login failed — try a new QR code from Hub';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return HudScaffold(
      title: 'LOGIN',
      connected: false,
      voiceHints: const ['SCAN', 'TORCH ON'],
      body: Row(
        children: [
          // Left — camera viewfinder (square-ish in landscape)
          Expanded(
            flex: 5,
            child: Semantics(
              label: 'SCAN',
              child: MobileScanner(
                controller: _scanner,
                onDetect: _handleBarcode,
              ),
            ),
          ),
          // Right — instructions
          Expanded(
            flex: 4,
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'MIRA SIGN IN',
                    style: TextStyle(
                      color: Color(0xFF1E88E5),
                      fontSize: 22,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 2,
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    _statusMessage,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                    ),
                  ),
                  const SizedBox(height: 24),
                  const Text(
                    '1. Open MIRA Hub on your browser\n'
                    '2. Go to Settings → Connect Device\n'
                    '3. Point camera at the QR code',
                    style: TextStyle(
                      color: Color(0xFF90A4AE),
                      fontSize: 13,
                      height: 1.6,
                    ),
                  ),
                  const SizedBox(height: 24),
                  if (!_scanning)
                    const CircularProgressIndicator(color: Color(0xFF1E88E5)),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
