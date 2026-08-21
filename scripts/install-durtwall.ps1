param(
  [string]$Version = $env:DURTWALL_VERSION,
  [string]$BaseUrl = $env:DURTWALL_RELEASE_BASE_URL,
  [string]$InstallPath = "$env:USERPROFILE\bin\durtwall.exe"
)
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($Version)) { $Version = 'latest' }
if ([string]::IsNullOrWhiteSpace($BaseUrl)) { throw 'Set DURTWALL_RELEASE_BASE_URL to the trusted release host' }
$arch = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq 'Arm64') { 'arm64' } else { 'amd64' }
$asset = "durtwall-windows-$arch.exe"
$temp = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
$checksum = "$temp.sha256"
try {
  Invoke-WebRequest "$BaseUrl/$Version/$asset" -OutFile $temp
  Invoke-WebRequest "$BaseUrl/$Version/$asset.sha256" -OutFile $checksum
  $expected = (Get-Content $checksum -Raw).Trim().Split(' ')[0]
  $actual = (Get-FileHash $temp -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($expected.ToLowerInvariant() -ne $actual) { throw 'Checksum verification failed' }
  New-Item (Split-Path $InstallPath) -ItemType Directory -Force | Out-Null
  Copy-Item $temp $InstallPath -Force
  Write-Output "Installed durtwall $Version ($arch) at $InstallPath"
} finally {
  Remove-Item $temp, $checksum -Force -ErrorAction SilentlyContinue
}
