import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/repositories/app_version_repository.dart';
import 'package:mobile_app/services/api_client.dart';
import 'package:mobile_app/services/app_version_api_service.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';

Map<String, dynamic> _policyJson({
  String minimumVersion = '1.0.0',
  String latestVersion = '1.0.0',
  bool forceUpdate = false,
}) => {
  'platform': 'android',
  'minimumVersion': minimumVersion,
  'latestVersion': latestVersion,
  'forceUpdate': forceUpdate,
  'storeUrl': 'https://play.google.com/store/apps/details?id=com.livequeue.mobile_app',
  'message': 'A new version of LiveQueue is available.',
};

void _setInstalledVersion(String version) => PackageInfo.setMockInitialValues(
  appName: 'LiveQueue',
  packageName: 'com.livequeue.mobile_app',
  version: version,
  buildNumber: '1',
  buildSignature: '',
);

AppVersionRepository _repositoryWith(Map<String, dynamic>? responseJson, {int statusCode = 200}) {
  final mockClient = MockClient((request) async {
    if (responseJson == null) {
      throw Exception('simulated network failure');
    }
    return http.Response(jsonEncode({'success': true, 'data': responseJson}), statusCode);
  });
  final apiService = AppVersionApiService(ApiClient(httpClient: mockClient, baseUrl: 'http://localhost:4000'));
  return AppVersionRepository(apiService: apiService);
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('Test 6: installed version below minimum is blocked', () async {
    _setInstalledVersion('1.0.0');
    final repo = _repositoryWith(_policyJson(minimumVersion: '1.2.0', latestVersion: '1.4.0'));

    final result = await repo.checkCompatibility();

    expect(result.updateRequired, isTrue);
    expect(result.updateAvailable, isTrue);
  });

  test('Test 7: installed version equal to minimum is allowed', () async {
    _setInstalledVersion('1.2.0');
    final repo = _repositoryWith(_policyJson(minimumVersion: '1.2.0', latestVersion: '1.2.0'));

    final result = await repo.checkCompatibility();

    expect(result.updateRequired, isFalse);
  });

  test('Test 8: latest higher but minimum satisfied does not force a block', () async {
    _setInstalledVersion('1.2.0');
    final repo = _repositoryWith(_policyJson(minimumVersion: '1.1.0', latestVersion: '1.4.0'));

    final result = await repo.checkCompatibility();

    expect(result.updateRequired, isFalse);
    expect(result.updateAvailable, isTrue);
  });

  test('forceUpdate blocks even when the version comparison alone would not', () async {
    _setInstalledVersion('9.9.9');
    final repo = _repositoryWith(_policyJson(minimumVersion: '1.0.0', forceUpdate: true));

    final result = await repo.checkCompatibility();

    expect(result.updateRequired, isTrue);
  });

  test('Test 9: fetch failure with no cache fails open', () async {
    _setInstalledVersion('0.0.1');
    final repo = _repositoryWith(null);

    final result = await repo.checkCompatibility();

    expect(result.updateRequired, isFalse);
    expect(result.policy, isNull);
  });

  test('Test 10: a cached blocking policy still blocks when the network is down', () async {
    _setInstalledVersion('1.0.0');
    SharedPreferences.setMockInitialValues({
      'app_version_policy_cache_v1': jsonEncode(_policyJson(minimumVersion: '1.5.0')),
    });
    final repo = _repositoryWith(null);

    final result = await repo.checkCompatibility();

    expect(result.updateRequired, isTrue);
  });

  test('Test 11: malformed cached data is ignored safely (fails open, does not throw)', () async {
    _setInstalledVersion('0.0.1');
    SharedPreferences.setMockInitialValues({
      'app_version_policy_cache_v1': 'not valid json at all {{{',
    });
    final repo = _repositoryWith(null);

    final result = await repo.checkCompatibility();

    expect(result.updateRequired, isFalse);
  });

  test('a successful fetch replaces whatever was previously cached', () async {
    _setInstalledVersion('1.0.0');
    SharedPreferences.setMockInitialValues({
      'app_version_policy_cache_v1': jsonEncode(_policyJson(minimumVersion: '9.9.9')),
    });
    final repo = _repositoryWith(_policyJson(minimumVersion: '1.0.0'));

    final result = await repo.checkCompatibility();
    expect(result.updateRequired, isFalse);

    final prefs = await SharedPreferences.getInstance();
    final cached = jsonDecode(prefs.getString('app_version_policy_cache_v1')!) as Map<String, dynamic>;
    expect(cached['minimumVersion'], '1.0.0');
  });
}
