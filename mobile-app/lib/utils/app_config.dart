/// Build-time configuration (spec section 24: "Use build-time configuration:
/// API_BASE_URL. Do not hard-code production secrets into the mobile
/// application."). Override with:
///   flutter run --dart-define=API_BASE_URL=https://api.example.com
class AppConfig {
  AppConfig._();

  /// Defaults to the Android emulator's alias for the host machine's
  /// localhost, so `flutter run` works against a local dev backend with no
  /// extra configuration. Override for a real device or deployed backend.
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:4000',
  );
}
