/// A one-shot "your estimated time changed" announcement, raised only when
/// staff explicitly changed how long a service is expected to take (V2
/// functional-fix checkpoint).
///
/// Carries timing only — no serial number, no queue name, no staff
/// identity, nothing that could identify the customer to a shoulder-surfer
/// reading the popup.
///
/// Value equality is what makes the popup idempotent: the backend recomputes
/// every waiting token when one duration changes, so the same customer can
/// receive several identical events for one logical change, and only a
/// genuinely different time should interrupt them again.
class EtaUpdateNotice {
  const EtaUpdateNotice({required this.estimatedReadyAt, required this.estimatedWaitMinutes});

  /// When the backend now expects this customer to be served. Always a UTC
  /// instant from the API — the UI converts it to device-local time for
  /// display, never the other way around.
  final DateTime? estimatedReadyAt;
  final int? estimatedWaitMinutes;

  @override
  bool operator ==(Object other) =>
      other is EtaUpdateNotice &&
      other.estimatedReadyAt == estimatedReadyAt &&
      other.estimatedWaitMinutes == estimatedWaitMinutes;

  @override
  int get hashCode => Object.hash(estimatedReadyAt, estimatedWaitMinutes);
}

/// Decides whether a recalculation is worth interrupting the customer for.
///
/// Kept as a pure function next to the model rather than inline in the
/// provider so every rule below is directly testable, and so there is one
/// place to read when asking "why did (or didn't) the popup appear?":
///
///  * only an explicit staff service-time change qualifies — ordinary queue
///    movement carries no reason and is already visible in the countdown;
///  * a token that is COMPLETED, CANCELLED or SKIPPED has no remaining wait
///    to update;
///  * an identical value is not re-announced, so the burst of events one
///    staff edit produces collapses into a single notice.
///
/// Returns null when there is nothing to show, in which case the caller
/// leaves whatever notice is already pending untouched.
EtaUpdateNotice? etaNoticeFor({
  required bool isStaffDurationChange,
  required bool tokenIsActive,
  required DateTime? estimatedReadyAt,
  required int? estimatedWaitMinutes,
  required EtaUpdateNotice? current,
}) {
  if (!isStaffDurationChange || !tokenIsActive) return null;

  final notice = EtaUpdateNotice(
    estimatedReadyAt: estimatedReadyAt,
    estimatedWaitMinutes: estimatedWaitMinutes,
  );
  return notice == current ? null : notice;
}
