import 'package:flutter/material.dart';

/// Shared HUD scaffold — dark industrial theme, 854×480 landscape.
///
/// Provides:
///  - Top status bar (screen title + connection indicator)
///  - Bottom voice-command tray (shows active "Say X" hints)
///  - Safe-area body for screen content
class HudScaffold extends StatelessWidget {
  final String title;
  final Widget body;
  final List<String> voiceHints; // shown in bottom tray
  final bool connected;
  final List<Widget>? actions;

  const HudScaffold({
    super.key,
    required this.title,
    required this.body,
    this.voiceHints = const [],
    this.connected = true,
    this.actions,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A0E1A), // near-black, easy on eyes
      appBar: PreferredSize(
        preferredSize: const Size.fromHeight(42),
        child: _TopBar(title: title, connected: connected, actions: actions),
      ),
      body: Column(
        children: [
          Expanded(child: body),
          if (voiceHints.isNotEmpty) _VoiceTray(hints: voiceHints),
        ],
      ),
    );
  }
}

class _TopBar extends StatelessWidget {
  final String title;
  final bool connected;
  final List<Widget>? actions;

  const _TopBar({
    required this.title,
    required this.connected,
    this.actions,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      color: const Color(0xFF111827),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        children: [
          const _MiraLogo(),
          const SizedBox(width: 12),
          Text(
            title,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 16,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.8,
            ),
          ),
          const Spacer(),
          if (actions != null) ...actions!,
          const SizedBox(width: 8),
          _ConnIndicator(connected: connected),
        ],
      ),
    );
  }
}

class _MiraLogo extends StatelessWidget {
  const _MiraLogo();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        border: Border.all(color: const Color(0xFF1E88E5), width: 1.5),
        borderRadius: BorderRadius.circular(3),
      ),
      child: const Text(
        'MIRA',
        style: TextStyle(
          color: Color(0xFF1E88E5),
          fontSize: 12,
          fontWeight: FontWeight.w900,
          letterSpacing: 2,
        ),
      ),
    );
  }
}

class _ConnIndicator extends StatelessWidget {
  final bool connected;
  const _ConnIndicator({required this.connected});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: connected ? const Color(0xFF4CAF50) : const Color(0xFFEF5350),
          ),
        ),
        const SizedBox(width: 4),
        Text(
          connected ? 'ONLINE' : 'OFFLINE',
          style: TextStyle(
            color: connected ? const Color(0xFF4CAF50) : const Color(0xFFEF5350),
            fontSize: 10,
            fontWeight: FontWeight.w700,
            letterSpacing: 1,
          ),
        ),
      ],
    );
  }
}

class _VoiceTray extends StatelessWidget {
  final List<String> hints;
  const _VoiceTray({required this.hints});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 28,
      color: const Color(0xFF0D1117),
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        children: [
          const Icon(Icons.mic, color: Color(0xFF1E88E5), size: 14),
          const SizedBox(width: 6),
          ...hints.map((h) => Padding(
                padding: const EdgeInsets.only(right: 20),
                child: Text(
                  'Say "$h"',
                  style: const TextStyle(
                    color: Color(0xFF90CAF9),
                    fontSize: 11,
                    letterSpacing: 0.3,
                  ),
                ),
              )),
        ],
      ),
    );
  }
}
