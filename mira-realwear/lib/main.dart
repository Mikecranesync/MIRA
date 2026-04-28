import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'services/voice_service.dart';
import 'screens/login_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Lock to landscape — RealWear Navigator 500/520 is landscape-only
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.landscapeLeft,
    DeviceOrientation.landscapeRight,
  ]);

  // Full-screen immersive: hide status bar + nav bar for max HUD area
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);

  await VoiceService.instance.init();

  runApp(const MiraApp());
}

class MiraApp extends StatelessWidget {
  const MiraApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'MIRA',
      debugShowCheckedModeBanner: false,
      theme: _buildTheme(),
      home: const LoginScreen(),
    );
  }

  ThemeData _buildTheme() {
    return ThemeData(
      brightness: Brightness.dark,
      scaffoldBackgroundColor: const Color(0xFF0A0E1A),
      colorScheme: const ColorScheme.dark(
        primary: Color(0xFF1E88E5),
        secondary: Color(0xFF4CAF50),
        surface: Color(0xFF111827),
        error: Color(0xFFEF5350),
      ),
      textTheme: const TextTheme(
        // All text defaults to white on dark background
        bodyMedium: TextStyle(color: Colors.white, fontSize: 14),
        bodyLarge: TextStyle(color: Colors.white, fontSize: 16),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: const Color(0xFF1E88E5),
          foregroundColor: Colors.white,
          textStyle: const TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.5,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(6),
          ),
        ),
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: Color(0xFF111827),
        foregroundColor: Colors.white,
        elevation: 0,
        titleTextStyle: TextStyle(
          color: Colors.white,
          fontSize: 16,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.8,
        ),
      ),
    );
  }
}
