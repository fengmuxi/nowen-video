param(
    [string]$Version = ""
)

$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptRoot

function Normalize-Version([string]$Raw) {
    if ([string]::IsNullOrWhiteSpace($Raw)) { return $null }

    $value = $Raw.Trim()
    if ($value.StartsWith("refs/tags/")) {
        $value = $value.Substring("refs/tags/".Length)
    }
    if ($value.StartsWith("v")) {
        $value = $value.Substring(1)
    }

    if ($value -match '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$') {
        return $value
    }

    return $null
}

function Get-GitTagVersion {
    $tag = (& git -C $ProjectRoot describe --tags --abbrev=0 --match "v[0-9]*" 2>$null)
    if ($LASTEXITCODE -eq 0) {
        return Normalize-Version $tag
    }
    return $null
}

function Resolve-AppVersion {
    $candidates = @(
        $Version,
        $env:NOWEN_VERSION,
        $env:APP_VERSION,
        $env:GITHUB_REF_NAME,
        (Get-GitTagVersion)
    )

    foreach ($candidate in $candidates) {
        $normalized = Normalize-Version $candidate
        if ($normalized) { return $normalized }
    }

    return "0.1.0"
}

function Update-FileContent([string]$Path, [scriptblock]$Updater) {
    if (-not (Test-Path $Path)) { return }

    $content = Get-Content $Path -Raw -Encoding UTF8
    $updated = & $Updater $content
    if ($updated -ne $content) {
        Set-Content $Path $updated -Encoding UTF8
    }
}

function Replace-First([string]$Content, [string]$Pattern, [string]$Replacement) {
    $regex = [regex]::new($Pattern)
    return $regex.Replace($Content, $Replacement, 1)
}

function Update-JsonVersion([string]$Path, [string]$VersionValue) {
    Update-FileContent $Path {
        param($content)
        Replace-First $content '(?m)^(\s*"version"\s*:\s*)"[^"]+"' "`${1}`"$VersionValue`""
    }
}

function Update-PackageLockVersion([string]$Path, [string]$VersionValue) {
    Update-FileContent $Path {
        param($content)
        $updated = Replace-First $content '(?m)^(\s*"version"\s*:\s*)"[^"]+"' "`${1}`"$VersionValue`""
        Replace-First $updated '(?ms)("packages"\s*:\s*\{\s*\r?\n\s*""\s*:\s*\{.*?\r?\n\s*"version"\s*:\s*)"[^"]+"' "`${1}`"$VersionValue`""
    }
}

function Update-RegexFile([string]$Path, [string]$Pattern, [string]$Replacement) {
    Update-FileContent $Path {
        param($content)
        Replace-First $content $Pattern $Replacement
    }
}

$appVersion = Resolve-AppVersion

Write-Host "Sync nowen-video version: $appVersion"

Update-JsonVersion (Join-Path $ProjectRoot "web/package.json") $appVersion
Update-PackageLockVersion (Join-Path $ProjectRoot "web/package-lock.json") $appVersion
Update-JsonVersion (Join-Path $ProjectRoot "desktop/src-tauri/tauri.conf.json") $appVersion

Update-RegexFile `
    (Join-Path $ProjectRoot "desktop/src-tauri/Cargo.toml") `
    '(?m)^(version\s*=\s*)"[^"]+"' `
    "`${1}`"$appVersion`""

Update-RegexFile `
    (Join-Path $ProjectRoot "desktop/src-tauri/Cargo.lock") `
    '(?ms)(\[\[package\]\]\s*\r?\nname\s*=\s*"nowen-video-desktop"\s*\r?\nversion\s*=\s*)"[^"]+"' `
    "`${1}`"$appVersion`""

Write-Host "Version synchronized to Web and desktop configs."