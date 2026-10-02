# Android release

Official APKs are built only by the **Android release** GitHub Actions workflow
(`.github/workflows/android-release.yml`). It builds from master, runs
`flutter analyze` and `flutter test`, builds with
`--dart-define=API_BASE_URL=https://livequeueapp.onrender.com`, and verifies the
APK (package, version, release certificate, production API) before it tags the
commit and publishes a GitHub Release with the APK attached.

A release build **fails** if signing is not configured. It never falls back to
the debug key (`mobile-app/android/app/build.gradle.kts`).

## One-time: create the release signing key (owner)

The release key is the app's permanent identity. Every future update must be
signed with the same key, or Android refuses to install it over the old app.
Keep the keystore and its passwords in a password manager and in at least one
offline backup. **Never commit them.**

On any machine with a JDK (Android Studio bundles one; on Windows use the
`keytool.exe` under `<Android Studio>\jbr\bin`):

```sh
keytool -genkeypair -v -keystore livequeue-release.jks \
  -storetype PKCS12 -alias livequeue -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=LiveQueue, O=LiveQueue"
```

`keytool` asks for a password. With PKCS12 the key password is the same as the
keystore password.

Base64-encode the files for GitHub (PowerShell):

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("livequeue-release.jks")) | Set-Clipboard
[Convert]::ToBase64String([IO.File]::ReadAllBytes("mobile-app\android\app\google-services.json")) | Set-Clipboard
```

(macOS/Linux: `base64 -w0 livequeue-release.jks`, or `base64 -i … | tr -d '\n'` on macOS.)

## One-time: GitHub secrets (owner)

Repository → Settings → Secrets and variables → Actions → **New repository secret**:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | base64 of `livequeue-release.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_ALIAS` | `livequeue` |
| `ANDROID_KEY_PASSWORD` | the key password (same as the keystore password for PKCS12) |
| `GOOGLE_SERVICES_JSON_BASE64` | base64 of `google-services.json` (Firebase console → Project settings → Android app `com.livequeue.mobile_app`) |

Optional, recommended once the first release is out: under the **Variables** tab
add `ANDROID_RELEASE_CERT_SHA256` with the certificate SHA-256 printed in the
first run's summary. From then on, any build signed by a different key fails.

## Cutting a release

1. Bump `version:` in `mobile-app/pubspec.yaml` (name and build number) on master
   and add `docs/releases/<tag>.md`.
2. Actions → **Android release** → Run workflow on `master`, with `tag` set to
   `v` + the Android `versionName` (for `version: 1.0.3+4`, the tag is `v1.0.3`;
   release tags always follow the app version). First run with `publish`
   unticked to check the build, then again with `publish` ticked.
3. The run summary lists the APK SHA-256 and signing certificate. The release
   gets `LiveQueue-<tag>.apk` attached.

## Local release builds

Create `mobile-app/android/key.properties` (gitignored):

```properties
storeFile=/absolute/path/to/livequeue-release.jks
storePassword=…
keyAlias=livequeue
keyPassword=…
```

Without it, `flutter build apk --release` stops with "Release signing is not
configured". Debug builds and `flutter run` are unaffected.

## Production fresh start (database)

`docs/ops/fresh-start.sql` empties every application table and keeps the
schema, indexes, constraints and `_prisma_migrations`. It aborts unless the
database has exactly the 25 expected migrations and exactly the 18 expected
application tables. Take a Neon backup branch of `production` first (Neon
console → Branches → Create branch, from `production`, e.g.
`pre-fresh-start-2026-10-02`), then run it with
`psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/ops/fresh-start.sql`. The Neon
SQL editor does not understand the `\set`/`\echo` lines; there, paste the
statements from `BEGIN;` through the final `SELECT` instead.
