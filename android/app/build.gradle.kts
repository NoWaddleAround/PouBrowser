plugins {
    id("com.android.application") version "9.2.1"
}

android {
    namespace = "com.nowaddlearound.poubrowser"
    compileSdk {
        version = release(37)
    }

    defaultConfig {
        applicationId = "com.nowaddlearound.poubrowser"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }

    // The script libraries (Dark Reader, AdGuard scriptlets, extended CSS) are the iOS app's copies.
    sourceSets.getByName("main").assets.srcDir("../../ios/Ruhe/Resources")

    buildTypes {
        release {
            // R8: drops unused code from OkHttp, Kotlin and AndroidX. The page bridges are WebMessageListeners,
            // not @JavascriptInterface methods, so no keep rules are needed for them.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }

    // The app has its own German/English texts in code; library translations for other languages are dead weight.
    androidResources {
        localeFilters += listOf("de", "en")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.core:core:1.13.0")
    implementation("androidx.webkit:webkit:1.18.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("junit:junit:4.13.2")
    // The real org.json for the sync merge tests; android.jar only has stubs.
    testImplementation("org.json:json:20240303")
}
