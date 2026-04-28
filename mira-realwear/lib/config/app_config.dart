/// MIRA backend configuration.
///
/// Override at build time via --dart-define:
///   flutter build apk --dart-define=MIRA_BASE_URL=https://your-host.com
library;

class AppConfig {
  AppConfig._();

  static const String baseUrl = String.fromEnvironment(
    'MIRA_BASE_URL',
    defaultValue: 'https://factorylm.com',
  );

  static const String groqApiKey = String.fromEnvironment(
    'GROQ_API_KEY',
    defaultValue: '',
  );

  // MIRA endpoints
  static String get chatEndpoint => '$baseUrl/api/v1/chat';
  static String get assetsEndpoint => '$baseUrl/api/v1/assets';
  static String get workOrdersEndpoint => '$baseUrl/api/v1/work-orders';
  static String get authQrEndpoint => '$baseUrl/api/v1/auth/qr';

  // Groq Whisper
  static const String groqWhisperUrl =
      'https://api.groq.com/openai/v1/audio/transcriptions';
  static const String groqWhisperModel = 'whisper-large-v3';

  // RealWear display target
  static const int displayWidth = 854;
  static const int displayHeight = 480;
}
