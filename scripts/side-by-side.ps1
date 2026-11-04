# Builds docs/evidence/m1-side-by-side.png: the reference window (cropped out of its
# backdrop and scaled to 1440 wide, the size measured in M0) next to the M1 screenshot.
# Run after `npx playwright test tests/home.spec.ts` has written docs/evidence/m1-home.png.
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$ref = [System.Drawing.Image]::FromFile("$root\docs\reference\dashboard.png")
$ours = [System.Drawing.Image]::FromFile("$root\docs\evidence\m1-home.png")

# Window rectangle inside the reference image (measured in M0, UI_MAP § Scale).
$crop = New-Object System.Drawing.Rectangle 68, 114, 1134, 724
$scale = $ours.Width / $crop.Width
$refH = [int]($crop.Height * $scale)

$gap = 40; $label = 48
$w = $ours.Width * 2 + $gap * 3
$h = [Math]::Max($refH, $ours.Height) + $label + $gap
$out = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($out)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear([System.Drawing.Color]::FromArgb(232, 232, 236))

$font = New-Object System.Drawing.Font 'Segoe UI', 18, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$ink = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(24, 24, 27))
$g.DrawString('Reference (scaled to 1440 wide)', $font, $ink, $gap, 14)
$g.DrawString('AgentDeck M1, demo data, 1440 x 924', $font, $ink, ($gap * 2 + $ours.Width), 14)

$g.DrawImage($ref, (New-Object System.Drawing.Rectangle $gap, $label, $ours.Width, $refH), $crop, [System.Drawing.GraphicsUnit]::Pixel)
$g.DrawImage($ours, ($gap * 2 + $ours.Width), $label, $ours.Width, $ours.Height)

$out.Save("$root\docs\evidence\m1-side-by-side.png", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $out.Dispose(); $ref.Dispose(); $ours.Dispose()
Write-Output "wrote docs/evidence/m1-side-by-side.png ($w x $h)"
