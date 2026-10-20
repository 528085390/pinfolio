Add-Type -AssemblyName System.Drawing
foreach ($n in @('mail-inbox','mail-dark','mail-account')) {
  $p = 'D:\pinfolio\docs\screenshots\' + $n + '.png'
  $img = [System.Drawing.Image]::FromFile($p)
  $w = 1600
  $h = [int]($img.Height * $w / $img.Width)
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($img, 0, 0, $w, $h)
  $g.Dispose()
  $img.Dispose()
  $bmp.Save($p, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
Get-ChildItem 'D:\pinfolio\docs\screenshots\mail-*.png' | Select-Object Name,Length | Format-Table -AutoSize
