/// Build-time configuration (spec section 24: "Use build-time configuration:
/// API_BASE_URL. Do not hard-code production secrets into the mobile
/// application."). Override with:
///   flutter run --dart-define=API_BASE_URL=https://api.example.com
///
/// The default is the Android emulator's alias for the host machine's
/// localhost, so `flutter run` works against a local dev backend with no
/// extra configuration. That address is unroutable from a physical phone: a
/// build that keeps it and is then installed on a real device reaches nothing
/// at all. Every request spends its full timeout and fails, which does not
/// look like a configuration mistake — it looks like a broken scanner and a
/// slow app, because that is where the waiting is visible. [usesLocalDevBackend]
/// exists so the app can say which of the two it is instead of leaving anyone
/// to guess.
class AppConfig {
  AppConfig._();

  /// The emulator-only default. Named so it can be recognised rather than
  /// repeated as a literal wherever the distinction matters.
  static const String localDevBaseUrl = 'http://10.0.2.2:4000';

  static const String _configuredBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
  );

  static String get apiBaseUrl =>
      _configuredBaseUrl.isEmpty ? localDevBaseUrl : _configuredBaseUrl;

  /// Whether this build was given an `API_BASE_URL` at all.
  static bool get isConfigured => _configuredBaseUrl.isNotEmpty;

  /// Whether this build will talk to the emulator alias — either because no
  /// `API_BASE_URL` was supplied, or because one was and it points there.
  /// True means the app only works on an emulator with a local backend
  /// running; on a real phone nothing will resolve.
  static bool get usesLocalDevBackend => apiBaseUrl == localDevBaseUrl;
}
