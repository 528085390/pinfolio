param(
  [string]$Dir = 'tmp',
  [int]$Width = 1600,
  [string]$Filter = '*.png'
)
# 把宽图等比缩到 $Width（默认 1600）：截图脚本按 deviceScaleFactor 1.5/2 拍的图太大，
# 缩一半再放进文档/issue。原地覆盖，跑之前自己留好原图。
Add-Type -AssemblyName System.Drawing
$files = Get-ChildItem (Join-Path $Dir $Filter) -ErrorAction SilentlyContinue
if (-not $files) { Write-Output ('没有匹配的文件：' + (Join-Path $Dir $Filter)); exit 1 }
foreach ($f in $files) {
  $img = [System.Drawing.Image]::FromFile($f.FullName)
  try {
    if ($img.Width -le $Width) { Write-Output ($f.Name + ' 已经是 ' + $img.Width + 'px，跳过'); continue }
    $h = [int]($img.Height * $Width / $img.Width)
    $bmp = New-Object System.Drawing.Bitmap $Width, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($img, 0, 0, $Width, $h)
    $g.Dispose()
    $img.Dispose()
    $img = $null
    $bmp.Save($f.FullName, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output ($f.Name + ' -> ' + $Width + 'x' + $h)
  } finally {
    if ($img) { $img.Dispose() }
  }
}
