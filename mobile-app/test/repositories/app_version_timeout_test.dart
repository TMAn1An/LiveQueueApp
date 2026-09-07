import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/repositories/app_version_repository.dart';
import 'package:mobile_app/services/api_client.dart';
import 'package:mobile_app/services/app_version_api_service.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The startup version check is the only network call left blocking Home.
/// The production backend sleeps when idle, so what matters is that a slow
/// or unreachable server costs seconds and then falls back — never that the
/// customer waits for it indefinitely.
Map<String, dynamic> _policyJson({String minimumVersion = '1.0.0', bool forceUpdate = false}) => {
  'platform': 'android',
  'minimumVersion': minimumVersion,
  'latestVersion': '1.0.0',
  'forceUpdate': forceUpdate,
  'storeUrl': '',
  'message': 'A new version of LiveQueue is available.',
};

void _setInstalledVersion(String version) => PackageInfo.setMockInitialValues(
  appName: 'LiveQueue',
  packageName: 'com.livequeue.mobile_app',
  version: version,
  buildNumber: '1',
  buildSignature: '',
);

/// A server that never answers — the shape of a sleeping backend.
AppVersionRepository _repositoryThatTimesOut() {
  final mockClient = MockClient((request) async {
    await Future<void>.delayed(const Duration(seconds: 30));
    return http.Response(jsonEncode({'success': true, 'data': _policyJson()}), 200);
  });
  return AppVersionRepository(
    apiService: AppVersionApiService(
      ApiClient(httpClient: mockClient, baseUrl: 'http://localhost:4000'),
    ),
  );
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    _setInstalledVersion('1.0.0');
  });

  test('the startup budget is shorter than the general request timeout', () {
    expect(startupRequestTimeout.inSeconds, lessThan(12));
    expect(startupRequestTimeout.inSeconds, greaterThanOrEqualTo(5));
  });

  test('an unresponsive backend does not hold startup for its full delay', () async {
    final repo = _repositoryThatTimesOut();

    final stopwatch = Stopwatch()..start();
    final result = await repo.checkCompatibility();
    stopwatch.stop();

    // Gives up on its own budget rather than the server's 30s, and fails
    // open so a backend outage can never become a mobile outage.
    expect(stopwatch.elapsed, lessThan(const Duration(seconds: 15)));
    expect(result.updateRequired, isFalse);
  });

  test('a cached blocking policy still blocks when the fetch times out', () async {
    // Written by an earlier successful launch: this install is already known
    // to be too old, and a slow network must not silently un-block it.
    SharedPreferences.setMockInitialValues({
      'app_version_policy_cache_v1': jsonEncode(_policyJson(minimumVersion: '2.0.0')),
    });
    final repo = _repositoryThatTimesOut();

    final result = await repo.checkCompatibility();

    expect(result.updateRequired, isTrue);
  });

  test('no cache plus a timeout fails open', () async {
    final repo = _repositoryThatTimesOut();

    final result = await repo.checkCompatibility();

    expect(result.updateRequired, isFalse);
  });
}
