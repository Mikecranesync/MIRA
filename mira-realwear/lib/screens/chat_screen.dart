import 'package:flutter/material.dart';
import '../models/equipment.dart';
import '../services/mira_api_client.dart';
import '../services/voice_service.dart';
import '../widgets/hud_scaffold.dart';
import '../widgets/wear_hf_button.dart';

class ChatScreen extends StatefulWidget {
  final Equipment? equipment;
  const ChatScreen({super.key, this.equipment});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final List<_ChatMessage> _messages = [];
  final ScrollController _scroll = ScrollController();
  bool _recording = false;
  bool _thinking = false;
  String? _sessionId;

  @override
  void dispose() {
    _scroll.dispose();
    VoiceService.instance.stop();
    super.dispose();
  }

  Future<void> _startRecording() async {
    if (_recording || _thinking) return;
    await VoiceService.instance.startRecording();
    setState(() => _recording = true);
  }

  Future<void> _stopAndSend() async {
    if (!_recording) return;
    setState(() {
      _recording = false;
      _thinking = true;
    });

    final transcript = await VoiceService.instance.stopAndTranscribe();
    if (transcript.isEmpty) {
      setState(() => _thinking = false);
      return;
    }

    setState(() {
      _messages.add(_ChatMessage(text: transcript, isUser: true));
    });
    _scrollToBottom();

    final result = await MiraApiClient.instance.chat(
      transcript,
      sessionId: _sessionId,
      equipment: widget.equipment,
    );

    if (!mounted) return;
    _sessionId = result.sessionId;
    setState(() {
      _thinking = false;
      _messages.add(_ChatMessage(text: result.reply, isUser: false));
    });
    _scrollToBottom();
    await VoiceService.instance.speak(result.reply);
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(
          _scroll.position.maxScrollExtent,
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final eq = widget.equipment;
    return HudScaffold(
      title: eq != null ? 'ASK MIRA — ${eq.model}' : 'ASK MIRA',
      voiceHints: _recording
          ? const ['STOP']
          : _thinking
              ? const []
              : const ['HOLD TO TALK', 'CLEAR'],
      body: Row(
        children: [
          // Left — chat transcript
          Expanded(
            flex: 7,
            child: _messages.isEmpty
                ? const Center(
                    child: Text(
                      'Hold "HOLD TO TALK" and describe the problem',
                      style: TextStyle(color: Color(0xFF546E7A), fontSize: 14),
                    ),
                  )
                : ListView.builder(
                    controller: _scroll,
                    padding: const EdgeInsets.all(12),
                    itemCount: _messages.length,
                    itemBuilder: (_, i) => _BubbleTile(msg: _messages[i]),
                  ),
          ),
          // Right — controls
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (_thinking)
                  const Column(
                    children: [
                      CircularProgressIndicator(color: Color(0xFF1E88E5)),
                      SizedBox(height: 8),
                      Text('Thinking…',
                          style: TextStyle(
                              color: Color(0xFF90A4AE), fontSize: 12)),
                    ],
                  )
                else
                  GestureDetector(
                    onLongPressStart: (_) => _startRecording(),
                    onLongPressEnd: (_) => _stopAndSend(),
                    child: WearHfButton(
                      voiceCommand: 'HOLD TO TALK',
                      onPressed: null, // long-press only
                      backgroundColor:
                          _recording ? const Color(0xFFD32F2F) : null,
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            _recording ? Icons.stop : Icons.mic,
                            size: 24,
                          ),
                          const SizedBox(height: 4),
                          Text(
                            _recording ? 'RELEASE TO SEND' : 'HOLD TO TALK',
                            style: const TextStyle(fontSize: 13),
                          ),
                        ],
                      ),
                    ),
                  ),
                const SizedBox(height: 12),
                WearHfButton(
                  voiceCommand: 'CLEAR',
                  backgroundColor: const Color(0xFF37474F),
                  padding: const EdgeInsets.symmetric(
                      horizontal: 16, vertical: 10),
                  fontSize: 14,
                  onPressed: () {
                    setState(() {
                      _messages.clear();
                      _sessionId = null;
                    });
                    VoiceService.instance.stop();
                  },
                  child: const Text('CLEAR'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ChatMessage {
  final String text;
  final bool isUser;
  _ChatMessage({required this.text, required this.isUser});
}

class _BubbleTile extends StatelessWidget {
  final _ChatMessage msg;
  const _BubbleTile({required this.msg});

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: msg.isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        constraints: const BoxConstraints(maxWidth: 420),
        decoration: BoxDecoration(
          color: msg.isUser
              ? const Color(0xFF1E3A5F)
              : const Color(0xFF1B2A1B),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: msg.isUser
                ? const Color(0xFF1E88E5)
                : const Color(0xFF2E7D32),
            width: 1,
          ),
        ),
        child: Text(
          msg.text,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 14,
            height: 1.4,
          ),
        ),
      ),
    );
  }
}
