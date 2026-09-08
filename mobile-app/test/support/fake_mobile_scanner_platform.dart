import 'dart:async';
import 'package:flutter/widgets.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

/// Stands in for the camera so the scanner screen can be tested at all.
///
/// A widget test has no camera and no platform channel, so without this the
/// scanner screen is the one screen in the app with no coverage — which is
/// exactly how a wedged scanner would reach a customer unnoticed. Only the
/// members [MobileScanner] actually uses are implemented; everything else
/// keeps the platform interface's own `UnimplementedError`, so a future
/// dependency on something new fails loudly rather than silently passing.
class FakeMobileScannerPlatform extends MobileScannerPlatform {
  final StreamController<BarcodeCapture?> _barcodes =
      StreamController<BarcodeCapture?>.broadcast();

  /// How many times the camera has been asked to start. The screen restarts
  /// it after a failed scan, so this is how "the scanner still works" is
  /// observed rather than assumed.
  int startCount = 0;
  int stopCount = 0;

  /// Set to have [start] throw, standing in for a denied camera permission.
  MobileScannerErrorCode? startError;

  bool get isRunning => startCount > stopCount;

  /// Delivers a scan, as the camera would.
  void emitBarcode(String rawValue) {
    _barcodes.add(
      BarcodeCapture(barcodes: [Barcode(rawValue: rawValue)]),
    );
  }

  @override
  Stream<BarcodeCapture?> get barcodesStream => _barcodes.stream;

  // The controller subscribes to both of these the moment it starts, so
  // they have to exist even though this screen offers no torch or zoom.
  @override
  Stream<TorchState> get torchStateStream => const Stream<TorchState>.empty();

  @override
  Stream<double> get zoomScaleStateStream => const Stream<double>.empty();

  @override
  Widget buildCameraView() => const SizedBox(key: Key('fake-camera-view'));

  @override
  Future<MobileScannerViewAttributes> start(StartOptions startOptions) async {
    if (startError case final code?) {
      throw MobileScannerException(errorCode: code);
    }
    startCount++;
    return const MobileScannerViewAttributes(
      cameraDirection: CameraFacing.back,
      currentTorchMode: TorchState.off,
      size: Size(1080, 1920),
      numberOfCameras: 1,
    );
  }

  @override
  Future<void> stop() async {
    stopCount++;
  }

  @override
  Future<void> updateScanWindow(Rect? window) async {}

  @override
  Future<void> dispose() async {
    await _barcodes.close();
  }
}
