import { env } from '../config/env';
import { AppError } from '../utils/AppError';

export type MobilePlatform = 'android';

/**
 * V2 Checkpoint 9 (ADR-031): server-authoritative mobile version policy.
 * Public, unauthenticated, additive — no organization/token/device data
 * involved. Returns the raw policy only (never a client-supplied installed
 * version's resolved compatibility); the mobile app performs the actual
 * major.minor.patch comparison itself, in one centralized, tested helper
 * (utils/semantic_version.dart), so the comparison logic lives in exactly
 * one place rather than being duplicated between this response and a
 * client-submitted version string.
 *
 * Android only — this app has never actually been built or shipped for iOS
 * (see docs/PROGRESS.md); there is no production iOS version to protect.
 * Adding iOS later is additive: a new MOBILE_IOS_* env block and one more
 * case here, not a redesign.
 */
export function getAppVersionPolicy(platform: MobilePlatform) {
  if (platform !== 'android') {
    throw new AppError(404, 'PLATFORM_NOT_SUPPORTED', 'This platform is not supported yet.');
  }

  return {
    platform,
    minimumVersion: env.MOBILE_ANDROID_MIN_VERSION,
    latestVersion: env.MOBILE_ANDROID_LATEST_VERSION,
    // An additive OR with the version comparison on the client side, never
    // a contradiction with minimumVersion — this can only ever widen
    // blocking (an emergency kill switch independent of the version
    // numbers), never narrow it. See ADR-031 for the full reasoning.
    forceUpdate: env.MOBILE_ANDROID_FORCE_UPDATE,
    storeUrl: env.MOBILE_ANDROID_STORE_URL,
    message: env.MOBILE_ANDROID_UPDATE_MESSAGE,
  };
}
