import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/models/eta_update_notice.dart';
import 'package:mobile_app/repositories/token_repository.dart';

/// Every rule that decides whether the customer sees an "estimated time
/// updated" popup.
void main() {
  final readyAt = DateTime.utc(2026, 9, 7, 14, 35);

  EtaUpdateNotice? decide({
    bool isStaffDurationChange = true,
    bool tokenIsActive = true,
    DateTime? estimatedReadyAt,
    int? estimatedWaitMinutes = 18,
    EtaUpdateNotice? current,
  }) => etaNoticeFor(
    isStaffDurationChange: isStaffDurationChange,
    tokenIsActive: tokenIsActive,
    estimatedReadyAt: estimatedReadyAt ?? readyAt,
    estimatedWaitMinutes: estimatedWaitMinutes,
    current: current,
  );

  group('PositionUpdate.isStaffDurationChange', () {
    test('is true only for the backend\'s duration_updated reason', () {
      const update = PositionUpdate(
        position: 2,
        estimatedWaitMinutes: 18,
        estimatedReadyAt: null,
        reason: 'duration_updated',
      );
      expect(update.isStaffDurationChange, isTrue);
    });

    test('is false for ordinary queue movement, which carries no reason', () {
      const update = PositionUpdate(position: 2, estimatedWaitMinutes: 18, estimatedReadyAt: null);
      expect(update.isStaffDurationChange, isFalse);
    });

    test('is false for a reason this app version does not recognise', () {
      const update = PositionUpdate(
        position: 2,
        estimatedWaitMinutes: 18,
        estimatedReadyAt: null,
        reason: 'some_future_reason',
      );
      expect(update.isStaffDurationChange, isFalse);
    });
  });

  group('etaNoticeFor', () {
    test('announces a staff service-time change for an active token', () {
      final notice = decide();

      expect(notice, isNotNull);
      expect(notice!.estimatedReadyAt, readyAt);
      expect(notice.estimatedWaitMinutes, 18);
    });

    test('stays silent for ordinary queue movement', () {
      expect(decide(isStaffDurationChange: false), isNull);
    });

    test('stays silent for a finished token — completed, cancelled or skipped', () {
      expect(decide(tokenIsActive: false), isNull);
    });

    test('does not re-announce an identical value', () {
      final first = decide();

      expect(decide(current: first), isNull);
    });

    test('announces again when the time actually changes', () {
      final first = decide();

      final second = decide(
        estimatedReadyAt: readyAt.add(const Duration(minutes: 10)),
        estimatedWaitMinutes: 28,
        current: first,
      );

      expect(second, isNotNull);
      expect(second, isNot(first));
    });
  });
}
