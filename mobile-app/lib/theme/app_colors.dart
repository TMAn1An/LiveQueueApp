import 'package:flutter/material.dart';

/// The LiveQueue brand palette, sampled directly from the official logo
/// artwork rather than approximated:
///
///  * [brandBlue] is the blue of the "LIVE" wordmark stroke (#0F539E)
///  * [brandTeal] is the teal of "QUEUE" (#25A596)
///  * [brandTealLight] is the lighter teal of the ribbon (#2CB69F)
///
/// Everything else is a tint or shade of those two anchors.
///
/// Semantic colors are deliberately absent. Red stays `Colors.red` for
/// errors and destructive states, orange for waiting/warning, green for
/// success — branding must never make a failure look like an ordinary
/// screen. Contrast note: white on [brandBlue] is 7.6:1, but white on
/// [brandTeal] is only 3.0:1, so teal is used for fills and accents and
/// [brandTealDark] (5.9:1) is the readable teal for text.
abstract final class AppColors {
  static const Color brandBlue = Color(0xFF0F539E);
  static const Color brandBlueDark = Color(0xFF0A4179);
  static const Color brandBlueLight = Color(0xFF3C7CBC);

  static const Color brandTeal = Color(0xFF25A596);
  static const Color brandTealDark = Color(0xFF0F7168);
  static const Color brandTealLight = Color(0xFF2CB69F);

  /// Tinted background for brand-colored panels and highlights.
  static const Color brandSurface = Color(0xFFEEF5FC);

  /// Darkest brand shade, for headings on a light surface.
  static const Color brandText = Color(0xFF0C2B4B);
}
