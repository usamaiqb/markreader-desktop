# SPDX-License-Identifier: GPL-3.0-only
# Copyright (c) 2026 DigiGate
#
# Sizes or captures the MarkReader window's client area (the app below the native title and
# menu bars), in physical pixels. Called by capture.mjs.
#
#   window.ps1 -Action resize -Width 2240 -Height 1400
#   window.ps1 -Action shot -Out metadata/screenshots/01-main-light.png

param(
	[Parameter(Mandatory)][ValidateSet('resize', 'shot')][string]$Action,
	[int]$Width = 2240,
	[int]$Height = 1400,
	[string]$Out
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Win {
	[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
	[StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
	[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
	[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
	[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
	[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
	[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
	[DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
	[DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);
}
'@

# Per-monitor aware, so every coordinate below is a real pixel rather than a scaled one.
[void][Win]::SetProcessDpiAwarenessContext([IntPtr]-4)

$process = Get-Process markreader -ErrorAction SilentlyContinue |
	Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $process) { throw 'No MarkReader window found.' }
$hwnd = $process.MainWindowHandle

[void][Win]::ShowWindow($hwnd, 9)   # SW_RESTORE
[void][Win]::SetForegroundWindow($hwnd)

$window = New-Object Win+RECT
$client = New-Object Win+RECT
[void][Win]::GetWindowRect($hwnd, [ref]$window)
[void][Win]::GetClientRect($hwnd, [ref]$client)

if ($Action -eq 'resize') {
	# Grow the outer window by whatever the frame, title bar and menu bar take up, so the
	# client area comes out at exactly the requested size.
	$frameW = ($window.Right - $window.Left) - $client.Right
	$frameH = ($window.Bottom - $window.Top) - $client.Bottom
	[void][Win]::SetWindowPos($hwnd, [IntPtr]::Zero, 0, 0, $Width + $frameW, $Height + $frameH, 0x0044)  # NOZORDER | SHOWWINDOW
	exit 0
}

Start-Sleep -Milliseconds 300
$origin = New-Object Win+POINT
[void][Win]::ClientToScreen($hwnd, [ref]$origin)
$w = $client.Right
$h = $client.Bottom

$bitmap = New-Object System.Drawing.Bitmap $w, $h
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($origin.X, $origin.Y, 0, 0, $bitmap.Size)
$bitmap.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
Write-Output "$Out ($w x $h)"
