<#
  Génère l'icône de Portscope (radar sur fond graphite, DA du portfolio) :
  - scripts/portscope.ico : raccourci Windows (16 à 256 px) ;
  - app/icon.png : favicon et icône de la fenêtre de l'app.
  Relancer ce script après une modification du dessin.
#>
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot

function New-IconBitmap([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $s = [single]$size
  $bg = [System.Drawing.ColorTranslator]::FromHtml("#101216")
  $ink = [System.Drawing.ColorTranslator]::FromHtml("#f3f1eb")
  $steel = [System.Drawing.ColorTranslator]::FromHtml("#6f93e0")
  $amber = [System.Drawing.ColorTranslator]::FromHtml("#e0913a")

  # Fond : carré graphite légèrement arrondi (lisible dans la barre des tâches).
  $r = $s * 0.18
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc(0, 0, $r * 2, $r * 2, 180, 90)
  $path.AddArc($s - $r * 2, 0, $r * 2, $r * 2, 270, 90)
  $path.AddArc($s - $r * 2, $s - $r * 2, $r * 2, $r * 2, 0, 90)
  $path.AddArc(0, $s - $r * 2, $r * 2, $r * 2, 90, 90)
  $path.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush $bg), $path)

  $c = $s / 2
  $stroke = [Math]::Max(1.2, $s * 0.045)
  $outer = $s * 0.36

  # Balayage du radar (secteur clair translucide), omis en très petite taille.
  if ($size -ge 32) {
    $sweep = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(46, $ink))
    $g.FillPie($sweep, $c - $outer, $c - $outer, $outer * 2, $outer * 2, -90, 70)
  }

  # Anneaux : extérieur = réseau, intérieur = local.
  $penOuter = New-Object System.Drawing.Pen ($ink), $stroke
  $g.DrawEllipse($penOuter, $c - $outer, $c - $outer, $outer * 2, $outer * 2)
  if ($size -ge 24) {
    $inner = $s * 0.2
    $penInner = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(150, $ink)), ($stroke * 0.8)
    $g.DrawEllipse($penInner, $c - $inner, $c - $inner, $inner * 2, $inner * 2)
  }

  # Points : un processus exposé (ambre) et un local (acier).
  $dot = [Math]::Max(3.5, $s * 0.14)
  $ax = $c + $outer * 0.62; $ay = $c - $outer * 0.78
  $g.FillEllipse((New-Object System.Drawing.SolidBrush $amber), $ax - $dot / 2, $ay - $dot / 2, $dot, $dot)
  if ($size -ge 24) {
    $small = $dot * 0.7
    $lx = $c - $s * 0.1; $ly = $c + $s * 0.08
    $g.FillEllipse((New-Object System.Drawing.SolidBrush $steel), $lx - $small / 2, $ly - $small / 2, $small, $small)
  }

  $g.Dispose()
  return $bmp
}

function Get-PngBytes($bmp) {
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  return $ms.ToArray()
}

# Image d'icône classique (DIB 32 bits BGRA, de bas en haut, + masque AND vide) :
# le format le plus compatible pour les petites tailles.
function Get-DibBytes($bmp) {
  $n = $bmp.Width
  $ms = New-Object System.IO.MemoryStream
  $w = New-Object System.IO.BinaryWriter $ms
  $w.Write([UInt32]40); $w.Write([Int32]$n); $w.Write([Int32]($n * 2))
  $w.Write([UInt16]1); $w.Write([UInt16]32); $w.Write([UInt32]0)
  $w.Write([UInt32]0); $w.Write([Int32]0); $w.Write([Int32]0); $w.Write([UInt32]0); $w.Write([UInt32]0)
  for ($y = $n - 1; $y -ge 0; $y--) {
    for ($x = 0; $x -lt $n; $x++) {
      $px = $bmp.GetPixel($x, $y)
      $w.Write([byte]$px.B); $w.Write([byte]$px.G); $w.Write([byte]$px.R); $w.Write([byte]$px.A)
    }
  }
  $maskRow = [int]([Math]::Ceiling($n / 32) * 4)
  $w.Write((New-Object byte[] ($maskRow * $n)))
  $w.Flush()
  return $ms.ToArray()
}

# ICO multi-tailles : DIB jusqu'à 128 px, PNG pour 256 px (usage standard de Windows).
$sizes = 16, 24, 32, 48, 64, 128, 256
$images = New-Object 'System.Collections.Generic.List[byte[]]'
foreach ($size in $sizes) {
  $bmp = New-IconBitmap $size
  if ($size -ge 256) { $images.Add([byte[]](Get-PngBytes $bmp)) } else { $images.Add([byte[]](Get-DibBytes $bmp)) }
}
$ico = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $ico
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $dim = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
  $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([UInt16]1); $w.Write([UInt16]32)
  $w.Write([UInt32]$images[$i].Length); $w.Write([UInt32]$offset)
  $offset += $images[$i].Length
}
foreach ($bytes in $images) { $w.Write($bytes) }
$w.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $PSScriptRoot "portscope.ico"), $ico.ToArray())
[System.IO.File]::WriteAllBytes((Join-Path $root "app\icon.png"), (Get-PngBytes (New-IconBitmap 256)))
Write-Host "Icônes générées."
