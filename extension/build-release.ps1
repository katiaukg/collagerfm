$ErrorActionPreference = "Stop"

$extensionRoot = $PSScriptRoot
$distRoot = Join-Path $extensionRoot "dist"
$chromeStage = Join-Path $distRoot "chrome"
$firefoxStage = Join-Path $distRoot "firefox"
$chromeManifest = Get-Content -LiteralPath (Join-Path $extensionRoot "manifest.json") -Raw | ConvertFrom-Json
$firefoxManifest = Get-Content -LiteralPath (Join-Path $extensionRoot "manifest.firefox.json") -Raw | ConvertFrom-Json

if ($chromeManifest.version -ne $firefoxManifest.version) {
    throw "Chrome and Firefox manifests must use the same version."
}

$releaseVersion = $chromeManifest.version
$chromeZip = Join-Path $distRoot "collagerfm-chrome-$releaseVersion.zip"
$firefoxZip = Join-Path $distRoot "collagerfm-firefox-$releaseVersion.zip"

$sharedFiles = @(
    "background.js",
    "bridge.js",
    "history.css",
    "history.html",
    "history.js",
    "i18n.js",
    "lastfm-content.js",
    "popup.css",
    "popup.html",
    "popup.js"
)

foreach ($stage in @($chromeStage, $firefoxStage)) {
    if (Test-Path -LiteralPath $stage) {
        Remove-Item -LiteralPath $stage -Recurse -Force
    }
    New-Item -ItemType Directory -Path $stage | Out-Null

    foreach ($file in $sharedFiles) {
        Copy-Item -LiteralPath (Join-Path $extensionRoot $file) -Destination $stage
    }

    Copy-Item -LiteralPath (Join-Path $extensionRoot "icons") -Destination $stage -Recurse
    Copy-Item -LiteralPath (Join-Path $extensionRoot "_locales") -Destination $stage -Recurse
}

Copy-Item -LiteralPath (Join-Path $extensionRoot "manifest.json") -Destination (Join-Path $chromeStage "manifest.json")
Copy-Item -LiteralPath (Join-Path $extensionRoot "manifest.firefox.json") -Destination (Join-Path $firefoxStage "manifest.json")

foreach ($archive in @($chromeZip, $firefoxZip)) {
    if (Test-Path -LiteralPath $archive) {
        Remove-Item -LiteralPath $archive -Force
    }
}

Compress-Archive -Path (Join-Path $chromeStage "*") -DestinationPath $chromeZip -CompressionLevel Optimal
Compress-Archive -Path (Join-Path $firefoxStage "*") -DestinationPath $firefoxZip -CompressionLevel Optimal

Write-Host "Chrome package:  $chromeZip"
Write-Host "Firefox package: $firefoxZip"
