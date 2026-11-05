# Generates the AgentDeck mark (two stacked cards on an accent tile) as PNGs in resources/.
# Run: powershell -File scripts/make-icons.ps1
Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot '..\resources'
New-Item -ItemType Directory -Force $out | Out-Null

function RoundRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = 2 * $r
  $p.AddArc($x, $y, $d, $d, 180, 90); $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90); $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure(); return $p
}

function Mark([int]$size, [string]$file, [string]$dot) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.Clear([System.Drawing.Color]::Transparent)
  $u = $size / 16.0
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 10, 132, 255))), (RoundRect 0 0 $size $size (4.5 * $u)))
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(150, 255, 255, 255))), (RoundRect (5.5 * $u) (3 * $u) (7.5 * $u) (6.5 * $u) (1.6 * $u)))
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)), (RoundRect (3 * $u) (6.5 * $u) (7.5 * $u) (6.5 * $u) (1.6 * $u)))
  if ($dot) {
    # ARCHITECTURE 7: amber = needs you, red = hooks missing, gray = paused
    $c = switch ($dot) {
      'attention' { [System.Drawing.Color]::FromArgb(255, 245, 158, 11) }
      'paused' { [System.Drawing.Color]::FromArgb(255, 148, 163, 184) }
      default { [System.Drawing.Color]::FromArgb(255, 239, 68, 68) }
    }
    $g.CompositingMode = 'SourceCopy'
    $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::Transparent)), (8.5 * $u), (8.5 * $u), (7.5 * $u), (7.5 * $u))
    $g.CompositingMode = 'SourceOver'
    $g.FillEllipse((New-Object System.Drawing.SolidBrush $c), (9.75 * $u), (9.75 * $u), (5.5 * $u), (5.5 * $u))
  }
  $bmp.Save((Join-Path $out $file), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

# Taskbar overlay badge: the open P1+P2 count on a red disc (white on #DC2626 is 4.8:1).
function Badge([int]$size, [string]$file, [string]$text) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'; $g.Clear([System.Drawing.Color]::Transparent)
  $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 220, 38, 38))), 0, 0, $size, $size)
  $em = if ($text.Length -gt 1) { $size * 0.5 } else { $size * 0.66 }
  $font = New-Object System.Drawing.Font 'Segoe UI', $em, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
  $g.DrawString($text, $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF 0, (0.04 * $size), $size, $size), $fmt)
  $bmp.Save((Join-Path $out $file), [System.Drawing.Imaging.ImageFormat]::Png)
  $font.Dispose(); $g.Dispose(); $bmp.Dispose()
}

Mark 256 'icon.png' $null
foreach ($v in @(@{ n = 'tray'; d = $null }, @{ n = 'tray-attention'; d = 'attention' }, @{ n = 'tray-failed'; d = 'failed' }, @{ n = 'tray-paused'; d = 'paused' })) {
  Mark 16 "$($v.n).png" $v.d
  Mark 32 "$($v.n)@2x.png" $v.d
}
foreach ($n in @('1', '2', '3', '4', '5', '6', '7', '8', '9', '9+')) {
  $name = "badge-$($n.Replace('+', 'plus'))"
  Badge 16 "$name.png" $n
  Badge 32 "$name@2x.png" $n
}
