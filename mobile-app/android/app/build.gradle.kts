import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    // START: FlutterFire Configuration
    id("com.google.gms.google-services")
    // END: FlutterFire Configuration
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Release signing. The keystore and its passwords are never committed:
// `android/key.properties` (gitignored) points at a keystore outside the
// repository, and CI writes both from GitHub Actions secrets. A release
// build without them fails rather than quietly signing with the debug key.
val keystorePropertiesFile = rootProject.file("key.properties")
val keystoreProperties = Properties()
if (keystorePropertiesFile.exists()) {
    FileInputStream(keystorePropertiesFile).use { keystoreProperties.load(it) }
}
val releaseSigningKeys = listOf("storeFile", "storePassword", "keyAlias", "keyPassword")
val missingReleaseSigningKeys = releaseSigningKeys.filter {
    keystoreProperties.getProperty(it).isNullOrBlank()
}
val hasReleaseSigning = missingReleaseSigningKeys.isEmpty() &&
    rootProject.file(keystoreProperties.getProperty("storeFile")!!).exists()

android {
    namespace = "com.livequeue.mobile_app"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // Required by flutter_local_notifications (spec section 7.18 turn
        // alerts / reminders) on Android.
        isCoreLibraryDesugaringEnabled = true
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.livequeue.mobile_app"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = rootProject.file(keystoreProperties.getProperty("storeFile")!!)
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
}

gradle.taskGraph.whenReady {
    val buildsRelease = allTasks.any {
        it.project == project && it.name.endsWith("Release") &&
            (it.name.startsWith("assemble") || it.name.startsWith("bundle") ||
                it.name.startsWith("package"))
    }
    if (buildsRelease && !hasReleaseSigning) {
        val reason = if (!keystorePropertiesFile.exists()) {
            "android/key.properties is missing"
        } else if (missingReleaseSigningKeys.isNotEmpty()) {
            "android/key.properties is missing: ${missingReleaseSigningKeys.joinToString()}"
        } else {
            "the keystore named by storeFile in android/key.properties does not exist"
        }
        throw GradleException(
            "Release signing is not configured ($reason). Refusing to build a " +
                "release APK signed with the debug key. See docs/ANDROID_RELEASE.md.",
        )
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
}
