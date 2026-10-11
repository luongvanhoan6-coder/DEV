# Tu cai + mo ZL-CRM tren Windows. Chay qua MO-ZL-CRM.bat
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$AdminEmail = 'admin@zlcrm.local'
$AdminPassword = 'Admin@123456'
$AdminPhone = '0900000000'
$AdminName = 'Quan Tri Vien'
$OrgName = 'ZL CRM'
$Url = 'http://localhost:3080'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host 'Chua co Docker. Cai Docker Desktop: https://www.docker.com/products/docker-desktop/'
  Start-Process 'https://www.docker.com/products/docker-desktop/'; exit 1
}
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Docker chua chay. Dang mo Docker Desktop, cho khoang 1 phut...'
  $dd = "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
  if (Test-Path $dd) { Start-Process $dd }
  for ($i = 0; $i -lt 60; $i++) { Start-Sleep 3; docker info *> $null; if ($LASTEXITCODE -eq 0) { break } }
  if ($LASTEXITCODE -ne 0) { Write-Host 'Docker van chua chay. Mo Docker Desktop roi chay lai.'; exit 1 }
}

if (-not (Test-Path 'ZL-CRM')) {
  if (Get-Command git -ErrorAction SilentlyContinue) {
    git clone --depth 1 https://github.com/nguyentatkiem/ZL-CRM.git
  } else {
    Write-Host 'Dang tai ma nguon (khong co git, tai file zip)...'
    $zip = Join-Path $env:TEMP 'zl-crm.zip'
    Invoke-WebRequest 'https://github.com/nguyentatkiem/ZL-CRM/archive/refs/heads/main.zip' -OutFile $zip
    Expand-Archive $zip -DestinationPath . -Force
    Rename-Item (Get-ChildItem -Directory -Filter 'ZL-CRM-*' | Select-Object -First 1).FullName 'ZL-CRM'
  }
}
Copy-Item -Force 'docker-compose.override.yml' 'ZL-CRM\'
Set-Location 'ZL-CRM'

function Rnd($n) { -join ((1..$n) | ForEach-Object { '0123456789abcdef'[(Get-Random -Max 16)] }) }
if (-not (Test-Path '.env')) {
  $db = Rnd 24; $mp = Rnd 24
  $map = @{
    'APP_URL' = $Url; 'JWT_SECRET' = (Rnd 64); 'ENCRYPTION_KEY' = (Rnd 64)
    'DB_PASSWORD' = $db; 'DATABASE_URL' = "postgresql://crmuser:$db@db:5432/zalocrm"
    'S3_ACCESS_KEY' = 'zlcrmadmin'; 'S3_SECRET_KEY' = $mp
    'MINIO_ROOT_USER' = 'zlcrmadmin'; 'MINIO_ROOT_PASSWORD' = $mp
    'BOOTSTRAP_ADMIN_PHONE' = $AdminPhone; 'BOOTSTRAP_ADMIN_PASSWORD' = $AdminPassword
    'BOOTSTRAP_ADMIN_NAME' = $AdminName; 'BOOTSTRAP_ADMIN_EMAIL' = $AdminEmail; 'BOOTSTRAP_ORG_NAME' = $OrgName
  }
  $lines = Get-Content '.env.example' | ForEach-Object {
    if ($_ -match '^REDIS_URL=') { "# $_" }
    elseif ($_ -match '^([A-Z_]+)=' -and $map.ContainsKey($Matches[1])) { "$($Matches[1])=$($map[$Matches[1]])" }
    else { $_ }
  }
  [IO.File]::WriteAllLines((Join-Path $PWD '.env'), $lines)
}

Write-Host 'Dang khoi dong ZL-CRM (lan dau mat 5-10 phut de build)...'
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { Write-Host 'Khoi dong that bai.'; exit 1 }

Write-Host 'Cho ung dung san sang...'
for ($i = 0; $i -lt 180; $i++) {
  try { Invoke-RestMethod "$Url/api/v1/setup/status" | Out-Null; break } catch { Start-Sleep 2 }
}

Write-Host '======================================'
Write-Host " ZL-CRM:   $Url"
Write-Host " Email:    $AdminEmail  (hoac SDT $AdminPhone)"
Write-Host " Mat khau: $AdminPassword"
Write-Host '======================================'
Start-Process $Url
