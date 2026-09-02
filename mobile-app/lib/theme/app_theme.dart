import 'package:flutter/material.dart';

import 'app_colors.dart';

/// One place where the app's Material theme is built, so no screen has to
/// hardcode a brand color of its own.
///
/// The scheme is still seeded (Material 3 derives the dozens of surface and
/// container roles from the seed), but primary/secondary are pinned to the
/// exact logo colors so the app matches the brand rather than a harmonized
/// approximation of it. `error` is left at the Material default: red must
/// keep meaning "something went wrong".
abstract final class AppTheme {
  static ThemeData get light {
    final scheme = ColorScheme.fromSeed(
      seedColor: AppColors.brandBlue,
      primary: AppColors.brandBlue,
      secondary: AppColors.brandTeal,
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: AppColors.brandBlue,
      ),
    );
  }
}
