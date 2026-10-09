# Generate standard Windows icon sizes from the supplied original artwork.
# Only resize/clip the outer rounded canvas; keep the original logo intact.
Add-Type -AssemblyName System.Drawing
$desktopRoot = Split-Path -Parent $PSScriptRoot
$artwork = [System.Drawing.Bitmap]::new((Join-Path $desktopRoot 'build/icon-source.png'))
function New-IconFrame([int]$size) {
    $frame = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($frame)
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.SmoothingMode = 'AntiAlias'
    $graphics.InterpolationMode = 'HighQualityBicubic'
    $graphics.PixelOffsetMode = 'HighQuality'
    $outline = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $diameter = [single]($size * 0.414)
    $edge = [single]$size
    $outline.AddArc(0, 0, $diameter, $diameter, 180, 90)
    $outline.AddArc(($edge - $diameter), 0, $diameter, $diameter, 270, 90)
    $outline.AddArc(($edge - $diameter), ($edge - $diameter), $diameter, $diameter, 0, 90)
    $outline.AddArc(0, ($edge - $diameter), $diameter, $diameter, 90, 90)
    $outline.CloseFigure()
    $graphics.SetClip($outline)
    $graphics.DrawImage($artwork, 0, 0, $size, $size)
    $outline.Dispose()
    $graphics.Dispose()
    return $frame
}
$publicDirectory = Join-Path $desktopRoot 'public'
New-Item -ItemType Directory -Path $publicDirectory -Force | Out-Null
$webFrame = New-IconFrame 512
$webFrame.Save((Join-Path $publicDirectory 'app-icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$webFrame.Dispose()
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$frames = foreach ($size in $sizes) {
    $frame = New-IconFrame $size
    $stream = [System.IO.MemoryStream]::new()
    $frame.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    [pscustomobject]@{ Size = $size; Bytes = $stream.ToArray() }
    $stream.Dispose()
    $frame.Dispose()
}
$writer = [System.IO.BinaryWriter]::new([System.IO.File]::Create((Join-Path $desktopRoot 'build/icon.ico')))
$writer.Write([uint16]0)
$writer.Write([uint16]1)
$writer.Write([uint16]$frames.Count)
$offset = [uint32](6 + 16 * $frames.Count)
foreach ($frame in $frames) {
    $dimension = if ($frame.Size -eq 256) { 0 } else { $frame.Size }
    $writer.Write([byte]$dimension)
    $writer.Write([byte]$dimension)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]32)
    $writer.Write([uint32]$frame.Bytes.Length)
    $writer.Write($offset)
    $offset += $frame.Bytes.Length
}
foreach ($frame in $frames) { $writer.Write([byte[]]$frame.Bytes) }
$writer.Dispose()
$artwork.Dispose()
Write-Output 'Generated app-icon.png and 7-size Windows icon.ico'
