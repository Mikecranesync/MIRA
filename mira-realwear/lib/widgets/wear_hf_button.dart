import 'package:flutter/material.dart';

/// A button that registers a WearHF voice command via Semantics.label.
///
/// RealWear WearHF reads the contentDescription (which Flutter maps from
/// Semantics.label) and adds "Say '[label]'" to the active voice command list.
/// All interactive elements in the app should use this widget.
class WearHfButton extends StatelessWidget {
  final String voiceCommand; // shown as "Say 'VOICE COMMAND'" on RealWear
  final VoidCallback? onPressed;
  final Widget child;
  final Color? backgroundColor;
  final double fontSize;
  final EdgeInsetsGeometry padding;

  const WearHfButton({
    super.key,
    required this.voiceCommand,
    required this.child,
    this.onPressed,
    this.backgroundColor,
    this.fontSize = 18,
    this.padding = const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
  });

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: voiceCommand,
      button: true,
      child: ElevatedButton(
        onPressed: onPressed,
        style: ElevatedButton.styleFrom(
          backgroundColor: backgroundColor ?? const Color(0xFF1E88E5),
          foregroundColor: Colors.white,
          padding: padding,
          textStyle: TextStyle(
            fontSize: fontSize,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.5,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(6),
          ),
        ),
        child: child,
      ),
    );
  }
}

/// Voice-command label widget — shows "Say 'CMD'" hint below interactive areas.
class WearHfHint extends StatelessWidget {
  final String command;
  const WearHfHint(this.command, {super.key});

  @override
  Widget build(BuildContext context) {
    return Text(
      "Say \"$command\"",
      style: const TextStyle(
        color: Color(0xFF90CAF9),
        fontSize: 11,
        letterSpacing: 0.3,
      ),
    );
  }
}
