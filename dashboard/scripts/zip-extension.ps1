$src = Join-Path $PSScriptRoot "..\..\extension"
$dst = Join-Path $PSScriptRoot "..\public\a3-os-extension.zip"

if (Test-Path $dst) {
    Remove-Item $dst -Force
}

Compress-Archive -Path "$src\*" -DestinationPath $dst -CompressionLevel Optimal
Write-Output "Extensão empacotada em $dst"
