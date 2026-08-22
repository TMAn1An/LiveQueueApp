import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import '../utils/app_config.dart';
import 'api_exception.dart';

/// Thin wrapper over `http` that understands the backend's response
/// envelope (`{ success, data }` / `{ success: false, error: { code,
/// message } }`, unchanged since Phase 1) and turns any non-2xx response
/// into a typed [ApiException]. No business logic lives here — that's the
/// repositories' job (CLAUDE.md Flutter rules: keep business logic outside
/// UI widgets and out of raw API wrappers).
class ApiClient {
  ApiClient({http.Client? httpClient, String? baseUrl})
      : _httpClient = httpClient ?? http.Client(),
        _baseUrl = baseUrl ?? AppConfig.apiBaseUrl;

  final http.Client _httpClient;
  final String _baseUrl;

  Uri _uri(String path) => Uri.parse('$_baseUrl$path');

  Map<String, dynamic> _decode(http.Response response) {
    if (response.body.isEmpty) return const {};
    return jsonDecode(response.body) as Map<String, dynamic>;
  }

  Map<String, dynamic> _handle(http.Response response) {
    final body = _decode(response);
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return (body['data'] as Map<String, dynamic>?) ?? const {};
    }

    final error = body['error'] as Map<String, dynamic>?;
    throw ApiException(
      statusCode: response.statusCode,
      code: (error?['code'] as String?) ?? 'UNKNOWN_ERROR',
      message: (error?['message'] as String?) ?? 'Something went wrong. Please try again.',
    );
  }

  Future<Map<String, dynamic>> get(String path) async {
    try {
      final response = await _httpClient.get(_uri(path), headers: {'Accept': 'application/json'});
      return _handle(response);
    } on SocketException {
      throw const NetworkException('No network connection. Please check your connection and try again.');
    }
  }

  Future<Map<String, dynamic>> post(
    String path, {
    Map<String, dynamic>? body,
    Map<String, String>? headers,
  }) async {
    try {
      final response = await _httpClient.post(
        _uri(path),
        headers: {'Content-Type': 'application/json', 'Accept': 'application/json', ...?headers},
        body: jsonEncode(body ?? const {}),
      );
      return _handle(response);
    } on SocketException {
      throw const NetworkException('No network connection. Please check your connection and try again.');
    }
  }

  void close() => _httpClient.close();
}
