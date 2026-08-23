# Firebase Admin / Backend Push Notifications — Setup & Verification

Phase 7 Step 7. Covers the backend half of push notifications only — the
Flutter mobile FCM integration (Firebase init, token retrieval, foreground/
background/terminated delivery, tap handling) is already implemented and
verified on a physical device; nothing here changes that.

## 1. Credential setup

The backend never receives Firebase credentials except through a local
service-account JSON file — never hardcoded, never committed.

1. In the Firebase Console for the `livequeue-99529` project: **Project
   Settings → Service Accounts → Generate new private key**. This downloads
   a JSON file.
2. Save that file *outside* version control anywhere on the machine running
   the backend — for local development, `backend/firebase-service-account.json`
   is a reasonable default (already covered by `.gitignore`'s
   `*service-account*.json` rule, so it cannot be committed even by
   accident).
3. Set `FIREBASE_SERVICE_ACCOUNT_PATH` in `backend/.env` to the absolute or
   relative path of that file.
4. Restart the backend. On startup (actually: on the first reminder-dispatch
   tick or FCM send attempt — initialization is lazy) the logs will show
   either *"Firebase Admin initialized — FCM dispatch is enabled."* or a
   warning that it's disabled.

**Leaving `FIREBASE_SERVICE_ACCOUNT_PATH` unset is a fully supported,
intentional configuration** — the backend starts normally, all other
features work normally, and reminder dispatch simply has nothing to send
through (every attempt is logged and skipped, never a crash).

Never print the file's contents. Never paste its contents into a chat,
issue, or log line — if this ever happens, the key must be revoked and
regenerated from the Firebase Console.

## 2. Device FCM token registration

`POST /api/devices/fcm-token` — public (no staff auth; the mobile app has no
device-authentication mechanism, ADR-011), same trust model as
`POST /api/devices/register`.

```
POST /api/devices/fcm-token
{ "deviceIdentifier": "<device uuid>", "fcmToken": "<FCM registration token>" }
```

One row per device (`DeviceFcmToken`, unique on `deviceId`) — registering a
new token for the same device replaces the old one. The raw token is never
returned in any API response and never appears in full in logs (only the
first 8 characters + length, matching the mobile app's own redacted-logging
convention).

## 3. Reminder preferences

`PUT /api/tokens/:tokenId/notification-preferences` — public, scoped to
`(deviceId, tokenId)` per the specification's own `NotificationPreference`
model (§15/§29.7). The device supplying `deviceIdentifier` must be the same
device that owns the token, or the request 404s.

```
PUT /api/tokens/{tokenId}/notification-preferences
{ "deviceIdentifier": "<device uuid>", "reminderMinutes": 10,
  "vibrationEnabled": true, "soundEnabled": true, "notificationsEnabled": true }
```

`reminderMinutes` must be ≥ 2 (spec minimum). **A token with no preference
row is never reminded** — this is the opt-in signal; nothing defaults to
"enabled." The current mobile app does not call this endpoint yet (it only
stores an equivalent preference locally) — a future mobile release would
need to call it for real customers to receive backend-dispatched reminders.

## 4. How the reminder scheduler works

`node-cron`, configured via `REMINDER_DISPATCH_CRON` (default `*/1 * * * *`,
every minute), started from `server.ts` on boot and never in
`NODE_ENV=test`. Each tick calls `dispatchReminders()`
(`src/services/reminderDispatch.service.ts`), which:

1. Selects `WAITING` tokens with a `NotificationPreference` row
   (`notificationsEnabled = true`) and a registered `DeviceFcmToken`, that
   haven't already been reminded (`reminderSentAt IS NULL`) — all filtered
   at the database level.
2. Recomputes `estimatedWaitMinutes` fresh for each candidate (reusing the
   existing token-engine formula, batched per queue — never per-token, and
   never treated as a fixed timestamp).
3. Sends once the estimate drops to at or below the customer's configured
   `reminderMinutes`.
4. Claims the send via a conditional (compare-and-swap) update
   (`reminderSentAt IS NULL` in the `WHERE` clause) *before* calling
   Firebase, so a crash mid-send under-delivers rather than duplicates.
5. On a permanently-invalid token (Firebase reports it unregistered), the
   `DeviceFcmToken` row is removed — the `Device` itself is never touched.

`node-cron`'s built-in `noOverlap: true` prevents a slow run from
overlapping the next tick. Every tick's failures are caught and logged —
they never crash the API process.

## 5. Running a manual dispatch (no real Firebase send required)

From a Node REPL or a throwaway script, against a real database:

```ts
import { dispatchReminders } from './src/services/reminderDispatch.service';
const summary = await dispatchReminders();
console.log(summary); // { scanned, sent, skipped, invalidTokensRemoved, failed }
```

With no `FIREBASE_SERVICE_ACCOUNT_PATH` configured, `sent` will always be
`0` and every eligible token will show up as `failed` (Firebase unavailable)
— this is expected, not a bug; it proves selection/eligibility logic without
sending anything.

## 6. Verifying real delivery (requires a real credential)

1. Configure `FIREBASE_SERVICE_ACCOUNT_PATH` as in section 1.
2. On the physical device, ensure the FCM token is known (it's already
   logged, redacted, by the existing mobile `FcmService`).
3. Register it: `POST /api/devices/fcm-token` with that device's real
   `deviceIdentifier` and FCM token.
4. Create a real token for a real queue via the normal customer flow, then
   `PUT .../notification-preferences` for it with a `reminderMinutes` value
   at or above the queue's current `estimatedWaitMinutes`.
5. Either wait for the next scheduler tick or call `dispatchReminders()`
   manually.
6. Check the backend logs for `"FCM notification sent"` (token redacted) and
   the physical device for the actual push notification.

This step could not be completed in this environment — no local
service-account credential exists. See the Step 7 report for exactly what's
needed to unblock it.
