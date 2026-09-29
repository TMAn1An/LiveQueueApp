// The foreground banner service (V2 Physical Validation + Foreground
// Notification checkpoint, Part F): a small non-blocking overlay that can
// appear above any screen, reached via a navigator key rather than a
// captured BuildContext.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/models/live_queue_token.dart';
import 'package:mobile_app/services/foreground_banner_service.dart';

void main() {
  late GlobalKey<NavigatorState> navigatorKey;

  Widget appUnder() {
    navigatorKey = GlobalKey<NavigatorState>();
    return MaterialApp(
      navigatorKey: navigatorKey,
      home: const Scaffold(body: Text('Home')),
    );
  }

  testWidgets('shows the given title and body over the current screen', (tester) async {
    await tester.pumpWidget(appUnder());
    final service = ForegroundBannerService(navigatorKey);

    service.show(title: 'A002 has been called', body: 'Pharmacy', onTap: () {});
    await tester.pump();

    expect(find.text('A002 has been called'), findsOneWidget);
    expect(find.text('Pharmacy'), findsOneWidget);
    // Still on Home underneath — this is an overlay, not a route.
    expect(find.text('Home'), findsOneWidget);

    service.dispose();
  });

  testWidgets('tapping the banner calls onTap and dismisses it', (tester) async {
    await tester.pumpWidget(appUnder());
    final service = ForegroundBannerService(navigatorKey);
    var tapped = false;

    service.show(title: 'A002 has been called', body: 'Pharmacy', onTap: () => tapped = true);
    await tester.pump();
    await tester.tap(find.text('View'));
    await tester.pump();

    expect(tapped, isTrue);
    expect(find.text('A002 has been called'), findsNothing);

    service.dispose();
  });

  testWidgets('the close button dismisses without calling onTap', (tester) async {
    await tester.pumpWidget(appUnder());
    final service = ForegroundBannerService(navigatorKey);
    var tapped = false;

    service.show(title: 'A002 has been called', body: 'Pharmacy', onTap: () => tapped = true);
    await tester.pump();
    await tester.tap(find.byIcon(Icons.close));
    await tester.pump();

    expect(tapped, isFalse);
    expect(find.text('A002 has been called'), findsNothing);

    service.dispose();
  });

  testWidgets('a second show() queues behind the first rather than replacing or stacking it',
      (tester) async {
    await tester.pumpWidget(appUnder());
    final service = ForegroundBannerService(navigatorKey);

    service.show(title: 'A002 has been called', body: 'Pharmacy', onTap: () {});
    await tester.pump();
    service.show(title: 'B014 has been called', body: 'Billing', onTap: () {});
    await tester.pump();

    // The first is still showing — never silently overwritten — and only
    // one is visible at once (no stacking).
    expect(find.text('A002 has been called'), findsOneWidget);
    expect(find.text('B014 has been called'), findsNothing);

    service.dispose();
  });

  testWidgets('dismissing the current banner shows the next queued one', (tester) async {
    await tester.pumpWidget(appUnder());
    final service = ForegroundBannerService(navigatorKey);

    service.show(title: 'A002 has been called', body: 'Pharmacy', onTap: () {});
    await tester.pump();
    service.show(title: 'B014 has been called', body: 'Billing', onTap: () {});
    await tester.pump();

    await tester.tap(find.byIcon(Icons.close));
    await tester.pump();

    expect(find.text('A002 has been called'), findsNothing);
    expect(find.text('B014 has been called'), findsOneWidget);

    service.dispose();
  });

  testWidgets('never auto-dismisses — stays visible indefinitely until explicitly dismissed',
      (tester) async {
    await tester.pumpWidget(appUnder());
    final service = ForegroundBannerService(navigatorKey);

    service.show(title: 'A002 has been called', body: 'Pharmacy', onTap: () {});
    await tester.pump();
    expect(find.text('A002 has been called'), findsOneWidget);

    await tester.pump(const Duration(minutes: 5));
    expect(find.text('A002 has been called'), findsOneWidget);

    service.dispose();
  });

  testWidgets('does nothing (never throws) if the overlay is not yet attached', (tester) async {
    final key = GlobalKey<NavigatorState>();
    final service = ForegroundBannerService(key);

    expect(() => service.show(title: 'x', body: 'y', onTap: () {}), returnsNormally);

    service.dispose();
  });

  testWidgets('a second show() with the same dedupeKey as the one on screen is dropped, not queued',
      (tester) async {
    await tester.pumpWidget(appUnder());
    final service = ForegroundBannerService(navigatorKey);

    service.show(title: 'A002 has been called', body: 'Pharmacy', onTap: () {}, dedupeKey: 'evt-1');
    await tester.pump();
    service.show(title: 'A002 has been called', body: 'Pharmacy', onTap: () {}, dedupeKey: 'evt-1');
    await tester.pump();

    // Dismissing the (only) visible card must reveal nothing queued behind
    // it — the second call was a no-op, not a second entry.
    await tester.tap(find.byIcon(Icons.close));
    await tester.pump();
    expect(find.text('A002 has been called'), findsNothing);

    service.dispose();
  });

  testWidgets('a dedupeKey matching an already-queued card is dropped rather than queued twice',
      (tester) async {
    await tester.pumpWidget(appUnder());
    final service = ForegroundBannerService(navigatorKey);

    service.show(title: 'A002 has been called', body: 'Pharmacy', onTap: () {}, dedupeKey: 'evt-1');
    await tester.pump();
    service.show(title: 'B014 has been called', body: 'Billing', onTap: () {}, dedupeKey: 'evt-2');
    await tester.pump();
    // Same key as the queued B014 card — must not add a second B014 entry.
    service.show(title: 'B014 has been called', body: 'Billing', onTap: () {}, dedupeKey: 'evt-2');
    await tester.pump();

    await tester.tap(find.byIcon(Icons.close));
    await tester.pump();
    expect(find.text('B014 has been called'), findsOneWidget);

    // Dismissing again must reveal nothing else queued — the duplicate
    // never joined the queue.
    await tester.tap(find.byIcon(Icons.close));
    await tester.pump();
    expect(find.text('B014 has been called'), findsNothing);
    expect(find.text('A002 has been called'), findsNothing);

    service.dispose();
  });

  testWidgets('without a dedupeKey, two calls with identical title/body still both show (opt-in dedup only)',
      (tester) async {
    await tester.pumpWidget(appUnder());
    final service = ForegroundBannerService(navigatorKey);

    service.show(title: 'A002 has been called', body: 'Pharmacy', onTap: () {});
    await tester.pump();
    service.show(title: 'A002 has been called', body: 'Pharmacy', onTap: () {});
    await tester.pump();

    await tester.tap(find.byIcon(Icons.close));
    await tester.pump();
    // The second call queued normally (no key was given to dedupe against).
    expect(find.text('A002 has been called'), findsOneWidget);

    service.dispose();
  });

  testWidgets('the icon reflects the token status the card is about', (tester) async {
    await tester.pumpWidget(appUnder());
    final service = ForegroundBannerService(navigatorKey);

    service.show(title: 'Your token was skipped', body: 'A002', onTap: () {}, status: TokenStatus.skipped);
    await tester.pump();
    expect(find.byIcon(Icons.report_gmailerrorred), findsOneWidget);
    expect(find.byIcon(Icons.record_voice_over), findsNothing);

    service.dispose();
  });

  testWidgets('with no status given, a generic bell icon is used', (tester) async {
    await tester.pumpWidget(appUnder());
    final service = ForegroundBannerService(navigatorKey);

    service.show(title: 'Your token was called', body: 'A002', onTap: () {});
    await tester.pump();
    expect(find.byIcon(Icons.notifications_active), findsOneWidget);

    service.dispose();
  });
}
