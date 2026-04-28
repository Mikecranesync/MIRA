import 'dart:io';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:record/record.dart';
import '../config/app_config.dart';

/// Handles both speech-to-text (Groq Whisper) and text-to-speech output.
class VoiceService {
  VoiceService._();
  static final VoiceService instance = VoiceService._();

  final AudioRecorder _recorder = AudioRecorder();
  final FlutterTts _tts = FlutterTts();
  bool _ttsReady = false;

  Future<void> init() async {
    await Permission.microphone.request();
    await _tts.setLanguage('en-US');
    await _tts.setSpeechRate(0.48);    // slightly slower for noisy shop floor
    await _tts.setVolume(1.0);
    await _tts.setPitch(1.0);
    _ttsReady = true;
  }

  // ── Recording ─────────────────────────────────────────────────────────────

  Future<void> startRecording() async {
    if (!await _recorder.hasPermission()) {
      await Permission.microphone.request();
    }
    final dir = await getTemporaryDirectory();
    final path = '${dir.path}/mira_voice_input.wav';
    await _recorder.start(
      const RecordConfig(encoder: AudioEncoder.wav, sampleRate: 16000),
      path: path,
    );
  }

  /// Stop recording and transcribe via Groq Whisper. Returns transcript text.
  Future<String> stopAndTranscribe() async {
    final path = await _recorder.stop();
    if (path == null) return '';

    final file = File(path);
    if (!file.existsSync() || file.lengthSync() < 1000) return '';

    return _transcribeWithGroq(file);
  }

  Future<bool> get isRecording => _recorder.isRecording();

  // ── Groq Whisper ─────────────────────────────────────────────────────────

  Future<String> _transcribeWithGroq(File audioFile) async {
    if (AppConfig.groqApiKey.isEmpty) {
      throw StateError('GROQ_API_KEY not configured — set via --dart-define');
    }
    final req = http.MultipartRequest(
      'POST',
      Uri.parse(AppConfig.groqWhisperUrl),
    )
      ..headers['Authorization'] = 'Bearer ${AppConfig.groqApiKey}'
      ..fields['model'] = AppConfig.groqWhisperModel
      ..fields['language'] = 'en'
      ..fields['response_format'] = 'json'
      ..files.add(await http.MultipartFile.fromPath('file', audioFile.path));

    final streamed = await req.send().timeout(const Duration(seconds: 30));
    final body = await streamed.stream.bytesToString();

    if (streamed.statusCode != 200) {
      throw HttpException('Groq Whisper error ${streamed.statusCode}: $body');
    }

    // Response: {"text": "transcribed content"}
    final json = body.replaceAll(RegExp(r'^\{"text":"(.*)"\}$'), r'$1');
    // Simple extraction without dart:convert to keep import clean
    final match = RegExp(r'"text"\s*:\s*"([^"]*)"').firstMatch(body);
    return match?.group(1) ?? '';
  }

  // ── TTS ───────────────────────────────────────────────────────────────────

  /// Speak a MIRA reply aloud. Interrupts any current speech.
  Future<void> speak(String text) async {
    if (!_ttsReady) return;
    await _tts.stop();
    await _tts.speak(text);
  }

  Future<void> stop() async {
    await _tts.stop();
    if (await _recorder.isRecording()) await _recorder.stop();
  }

  void dispose() {
    _recorder.dispose();
    _tts.stop();
  }
}
