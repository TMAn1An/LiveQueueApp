import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:provider/provider.dart';

import '../providers/queue_join_provider.dart';
import '../widgets/error_banner.dart';
import 'queue_details_screen.dart';

/// Spec section 7.15: scan -> validate format -> extract queue id -> request
/// public config -> display queue details.
class QrScannerScreen extends StatefulWidget {
  const QrScannerScreen({super.key});

  @override
  State<QrScannerScreen> createState() => _QrScannerScreenState();
}

class _QrScannerScreenState extends State<QrScannerScreen> {
  final MobileScannerController _controller = MobileScannerController();

  /// Suppresses the duplicate detections a scanner naturally produces while
  /// the same code stays in frame. Reset in a `finally` so a failure can
  /// never leave the screen permanently deaf to further scans.
  bool _handlingCode = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _onDetect(BarcodeCapture capture) async {
    if (_handlingCode) return;
    final raw = capture.barcodes.firstOrNull?.rawValue;
    if (raw == null || raw.isEmpty) return;

    _handlingCode = true;
    final provider = context.read<QueueJoinProvider>();
    var navigated = false;
    try {
      // Camera control is best-effort: if the platform refuses to pause,
      // the `_handlingCode` guard above still prevents a second lookup,
      // and failing here must not abort the scan we already have.
      await _safeCameraCall(_controller.stop);
      await provider.loadQueueFromScannedQr(raw);

      if (!mounted) return;
      if (provider.queueConfig != null) {
        navigated = true;
        await Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const QueueDetailsScreen()),
        );
      }
    } finally {
      // The scanner has to become usable again for every outcome that left
      // the customer on this screen — an invalid code, an unknown queue, a
      // network failure, or an unexpected error. Previously an exception
      // anywhere above left this flag set and the screen silently stopped
      // responding to any further scan, with mobile_scanner's default
      // error handler swallowing the cause.
      if (!navigated && mounted) {
        _handlingCode = false;
        await _safeCameraCall(_controller.start);
      }
    }
  }

  /// start()/stop() throw a [MobileScannerException] for states this screen
  /// cannot do anything about (already starting, not yet attached, disposed
  /// mid-navigation). Swallowing them here keeps the failure contained to
  /// the camera instead of taking down the scan-handling flow.
  Future<void> _safeCameraCall(Future<void> Function() call) async {
    try {
      await call();
    } on MobileScannerException {
      // Intentionally ignored — see above.
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Scan QR Code')),
      body: Stack(
        children: [
          MobileScanner(
            controller: _controller,
            onDetect: _onDetect,
            // Without this the package renders its own bare placeholder for
            // a denied camera permission or an unavailable camera, which
            // looks exactly like a scanner that simply does not work.
            errorBuilder: (context, error) => _ScannerError(error: error),
          ),
          Consumer<QueueJoinProvider>(
            builder: (context, provider, _) {
              if (provider.errorMessage == null) return const SizedBox.shrink();
              return Align(
                alignment: Alignment.bottomCenter,
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: ErrorBanner(message: provider.errorMessage!),
                ),
              );
            },
          ),
          if (context.watch<QueueJoinProvider>().isLoadingQueue)
            const Center(child: CircularProgressIndicator()),
        ],
      ),
    );
  }
}

/// Explains why there is no camera preview, in the customer's terms.
class _ScannerError extends StatelessWidget {
  const _ScannerError({required this.error});

  final MobileScannerException error;

  @override
  Widget build(BuildContext context) {
    final isPermission = error.errorCode == MobileScannerErrorCode.permissionDenied;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              isPermission ? Icons.no_photography_outlined : Icons.videocam_off_outlined,
              size: 48,
              color: Colors.grey,
            ),
            const SizedBox(height: 16),
            Text(
              isPermission
                  ? 'LiveQueue needs camera access to scan a queue QR code. Enable the camera permission for LiveQueue in your device settings, then reopen this screen.'
                  : 'The camera could not be started on this device. Please close and reopen this screen, or restart the app.',
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

extension _FirstOrNull<T> on List<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
