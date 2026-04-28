import 'dart:convert';
import 'dart:typed_data';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../config/app_config.dart';
import '../models/equipment.dart';
import '../models/work_order.dart';

class ChatResult {
  final String reply;
  final String? sessionId;
  const ChatResult({required this.reply, this.sessionId});
}

class MiraApiClient {
  MiraApiClient._();
  static final MiraApiClient instance = MiraApiClient._();

  String? _token;

  Future<String?> get token async {
    _token ??= (await SharedPreferences.getInstance()).getString('auth_token');
    return _token;
  }

  Future<Map<String, String>> _headers() async => {
        'Content-Type': 'application/json',
        if (await token case final t?) 'Authorization': 'Bearer $t',
      };

  // ── Auth ──────────────────────────────────────────────────────────────────

  Future<bool> loginWithQrCode(String code) async {
    try {
      final resp = await http
          .post(
            Uri.parse(AppConfig.authQrEndpoint),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({'code': code}),
          )
          .timeout(const Duration(seconds: 15));
      if (resp.statusCode != 200) return false;
      final body = jsonDecode(resp.body) as Map<String, dynamic>;
      final tok = body['token'] as String?;
      if (tok == null) return false;
      _token = tok;
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('auth_token', tok);
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<void> logout() async {
    _token = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('auth_token');
  }

  // ── Chat ──────────────────────────────────────────────────────────────────

  Future<ChatResult> chat(
    String message, {
    String? sessionId,
    Equipment? equipment,
    Uint8List? photoBytes,
  }) async {
    final headers = await _headers();
    final body = <String, dynamic>{
      'message': message,
      if (sessionId != null) 'session_id': sessionId,
      if (equipment != null) 'asset_id': equipment.id,
      if (photoBytes != null) 'photo_b64': base64Encode(photoBytes),
    };
    try {
      final resp = await http
          .post(
            Uri.parse(AppConfig.chatEndpoint),
            headers: headers,
            body: jsonEncode(body),
          )
          .timeout(const Duration(seconds: 30));

      if (resp.statusCode != 200) {
        return ChatResult(reply: 'Service unavailable (${resp.statusCode})');
      }
      final parsed = jsonDecode(resp.body) as Map<String, dynamic>;
      return ChatResult(
        reply: parsed['reply'] as String? ?? '',
        sessionId: parsed['session_id'] as String?,
      );
    } catch (e) {
      return ChatResult(reply: 'Connection error — check network');
    }
  }

  // ── Equipment ID ─────────────────────────────────────────────────────────

  Future<Equipment?> identifyEquipment(Uint8List photoBytes) async {
    try {
      final headers = await _headers();
      final resp = await http
          .post(
            Uri.parse('${AppConfig.assetsEndpoint}/identify'),
            headers: headers,
            body: jsonEncode({'photo_b64': base64Encode(photoBytes)}),
          )
          .timeout(const Duration(seconds: 20));

      if (resp.statusCode != 200) return null;
      final data = jsonDecode(resp.body) as Map<String, dynamic>;
      final asset = data['asset'] as Map<String, dynamic>?;
      return asset != null ? Equipment.fromJson(asset) : null;
    } catch (_) {
      return null;
    }
  }

  // ── Work Orders ──────────────────────────────────────────────────────────

  Future<bool> createWorkOrder(WorkOrder wo) async {
    try {
      final headers = await _headers();
      final resp = await http
          .post(
            Uri.parse(AppConfig.workOrdersEndpoint),
            headers: headers,
            body: jsonEncode(wo.toJson()),
          )
          .timeout(const Duration(seconds: 15));
      return resp.statusCode == 200 || resp.statusCode == 201;
    } catch (_) {
      return false;
    }
  }
}
