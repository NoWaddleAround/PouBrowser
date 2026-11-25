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

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.core:core:1.13.0")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("junit:junit:4.13.2")
}
