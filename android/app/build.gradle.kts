import java.io.ByteArrayOutputStream

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.hilt)
    alias(libs.plugins.ksp)
}

fun String.normalizedAppVersion(): String? {
    val cleaned = removePrefix("refs/tags/").removePrefix("v").trim()
    return cleaned.takeIf { it.matches(Regex("^[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.-]+)?$")) }
}

fun gitTagVersion(): String? = runCatching {
    val output = ByteArrayOutputStream()
    exec {
        commandLine("git", "describe", "--tags", "--abbrev=0", "--match", "v[0-9]*")
        standardOutput = output
        isIgnoreExitValue = true
    }
    output.toString().normalizedAppVersion()
}.getOrNull()

fun resolveAppVersion(): String = listOfNotNull(
    System.getenv("NOWEN_VERSION"),
    System.getenv("APP_VERSION"),
    System.getenv("GITHUB_REF_NAME"),
    gitTagVersion()
).firstNotNullOfOrNull { it.normalizedAppVersion() } ?: "0.1.0"

fun appVersionCode(version: String): Int {
    val base = version.substringBefore('-').split('.').map { it.toIntOrNull() ?: 0 }
    val major = base.getOrElse(0) { 0 }.coerceIn(0, 999)
    val minor = base.getOrElse(1) { 0 }.coerceIn(0, 999)
    val patch = base.getOrElse(2) { 0 }.coerceIn(0, 999)
    return major * 1_000_000 + minor * 1_000 + patch
}

val appVersionName = resolveAppVersion()

android {
    namespace = "com.nowen.video"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.nowen.video"
        minSdk = 26
        targetSdk = 35
        versionCode = appVersionCode(appVersionName)
        versionName = appVersionName

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        getByName("debug") {
            // 使用 Android SDK 自带的 debug.keystore
        }
        create("release") {
            storeFile = file("nowen-release.keystore")
            storePassword = "nowen2026"
            keyAlias = "nowen-video"
            keyPassword = "nowen2026"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            signingConfig = signingConfigs.getByName("release")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            isMinifyEnabled = false
            applicationIdSuffix = ".debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    // AndroidX 核心
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)

    // Compose
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons.extended)
    debugImplementation(libs.androidx.ui.tooling)

    // Navigation
    implementation(libs.androidx.navigation.compose)

    // Hilt DI
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.androidx.hilt.navigation.compose)

    // 网络
    implementation(libs.retrofit)
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.retrofit.kotlinx.serialization)

    // 图片加载
    implementation(libs.coil.compose)

    // 播放器
    implementation(libs.media3.exoplayer)
    implementation(libs.media3.exoplayer.hls)
    implementation(libs.media3.ui)
    implementation(libs.media3.session)

    // Room 数据库
    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)

    // DataStore
    implementation(libs.datastore.preferences)

    // 协程
    implementation(libs.kotlinx.coroutines.android)
}
