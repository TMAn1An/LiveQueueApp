import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/models/app_version_policy.dart';
import 'package:mobile_app/screens/update_required_screen.dart';

void main() {
  testWidgets('shows the blocking message, no dismiss action, and cannot be popped', (tester) async {
    const policy = AppVersionPolicy(
      platform: 'android',
      minimumVersion: '2.0.0',
      latestVersion: '2.0.0',
      forceUpdate: false,
      storeUrl: 'https://play.google.com/store/apps/details?id=com.livequeue.mobile_app',
      message: 'Please update to continue.',
    );
    const compatibility = AppVersionCompatibility(
      installedVersion: '1.0.0',
      policy: policy,
      updateRequired: true,
      updateAvailable: true,
    );

    await tester.pumpWidget(
      const MaterialApp(home: UpdateRequiredScreen(compatibility: compatibility)),
    );

    expect(find.text('Update Required'), findsOneWidget);
    expect(find.text('Please update to continue.'), findsOneWidget);
    expect(find.textContaining('1.0.0'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Update App'), findsOneWidget);
    // No dismiss/"Maybe Later" escape hatch of any kind.
    expect(find.textContaining('Maybe Later'), findsNothing);
    expect(find.textContaining('Skip'), findsNothing);
    expect(find.byType(BackButton), findsNothing);

    // The gate itself: a system back gesture (Android back button/gesture)
    // must not be able to pop this screen away.
    final popScope = tester.widget<PopScope>(find.byType(PopScope));
    expect(popScope.canPop, isFalse);
  });
}
