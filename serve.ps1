param([int]$Port = 5500)
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Write-Host "Server: http://127.0.0.1:$Port/"
$mime = @{'.html'='text/html; charset=utf-8';'.js'='application/javascript; charset=utf-8';'.css'='text/css; charset=utf-8';'.png'='image/png';'.jpg'='image/jpeg';'.jpeg'='image/jpeg';'.svg'='image/svg+xml';'.json'='application/json';'.wasm'='application/wasm'}
while ($listener.IsListening) {
  $ctx = $listener.GetContext(); $path = $ctx.Request.Url.LocalPath
  if ($path -eq '/') { $path = '/index.html' }
  $rel = $path.TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar)
  $file = Join-Path $root $rel; $res = $ctx.Response
  if (-not (Test-Path -LiteralPath $file) -or (Get-Item -LiteralPath $file).PSIsContainer) {
    $res.StatusCode = 404; $buf = [Text.Encoding]::UTF8.GetBytes('Not found'); $res.OutputStream.Write($buf,0,$buf.Length); $res.Close(); continue
  }
  $ext = [IO.Path]::GetExtension($file).ToLowerInvariant()
  $res.ContentType = $(if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' })
  $bytes = [IO.File]::ReadAllBytes($file); $res.ContentLength64 = $bytes.Length; $res.OutputStream.Write($bytes,0,$bytes.Length); $res.Close()
}
