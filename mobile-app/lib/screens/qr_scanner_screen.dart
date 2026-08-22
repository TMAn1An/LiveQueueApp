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
  bool _handledOneCode = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _onDetect(BarcodeCapture capture) async {
    if (_handledOneCode) return;
    final raw = capture.barcodes.firstOrNull?.rawValue;
    if (raw == null) return;

    _handledOneCode = true;
    final provider = context.read<QueueJoinProvider>();
    await _controller.stop();
    await provider.loadQueueFromScannedQr(raw);

    if (!mounted) return;

    if (provider.queueConfig != null) {
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => const QueueDetailsScreen()),
      );
    } else {
      // Invalid QR / queue not found — allow scanning again.
      setState(() => _handledOneCode = false);
      await _controller.start();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Scan QR Code')),
      body: Stack(
        children: [
          MobileScanner(controller: _controller, onDetect: _onDetect),
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

extension _FirstOrNull<T> on List<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
