param([Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class EfPhysicalDpi { [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c); }
"@
$old=[EfPhysicalDpi]::SetThreadDpiAwarenessContext([IntPtr](-4))
try{
  Add-Type -AssemblyName System.Drawing
  Add-Type -AssemblyName System.Windows.Forms
  $b=[System.Windows.Forms.SystemInformation]::VirtualScreen
  $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height
  $g=[System.Drawing.Graphics]::FromImage($bmp)
  try{$g.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size)}finally{$g.Dispose()}
  $dir=Split-Path -Parent $OutputPath;if($dir){New-Item -ItemType Directory -Force -Path $dir|Out-Null}
  $bmp.Save($OutputPath,[System.Drawing.Imaging.ImageFormat]::Png);$bmp.Dispose()
  Write-Host ('SIZE='+$b.Width+'x'+$b.Height)
} finally {[void][EfPhysicalDpi]::SetThreadDpiAwarenessContext($old)}
