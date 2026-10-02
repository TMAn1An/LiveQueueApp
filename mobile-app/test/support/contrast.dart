import 'package:flutter/material.dart';

/// WCAG 2.x contrast ratio between two opaque colors (1.0 to 21.0).
double contrastRatio(Color a, Color b) {
  final la = a.computeLuminance();
  final lb = b.computeLuminance();
  final lighter = la > lb ? la : lb;
  final darker = la > lb ? lb : la;
  return (lighter + 0.05) / (darker + 0.05);
}

/// WCAG AA minimum for normal-size text.
const double wcagAaNormalText = 4.5;

/// A dark theme seeded from the same brand color as `AppTheme.light`. The app
/// ships no dark theme yet; this stands in for one so widgets can be checked
/// for colors that only work on a light background.
ThemeData brandDarkTheme(Color seed) => ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(seedColor: seed, brightness: Brightness.dark),
    );
