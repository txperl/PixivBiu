# Read-only WM_NCHITTEST probes for an isolated Electron smoke-test window.
# Points are renderer CSS pixels; convert zoom and per-window DPI before
# ClientToScreen. Synthetic webContents mouse events bypass this native path.
param([long]$WindowHandle, [string]$PointsJson, [double]$ZoomFactor = 1)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WindowHitTest {
    [StructLayout(LayoutKind.Sequential)]
    public struct Point { public int X; public int Y; }
    [DllImport("user32.dll")]
    public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")]
    public static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll")]
    public static extern bool ClientToScreen(IntPtr window, ref Point point);
    [DllImport("user32.dll")]
    public static extern IntPtr SendMessageTimeout(IntPtr window, uint message,
        IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
}
"@
[void][WindowHitTest]::SetThreadDpiAwarenessContext([IntPtr](-4))
$probeHandle = [IntPtr]$WindowHandle
$probeScale = [WindowHitTest]::GetDpiForWindow($probeHandle) / 96.0 * $ZoomFactor
if ($probeScale -le 0) { throw 'Invalid smoke-test window DPI' }
$probeResults = foreach ($probeInput in (ConvertFrom-Json $PointsJson)) {
    $probePoint = New-Object WindowHitTest+Point
    $probePoint.X = [int][Math]::Round($probeInput.x * $probeScale)
    $probePoint.Y = [int][Math]::Round($probeInput.y * $probeScale)
    if (![WindowHitTest]::ClientToScreen($probeHandle, [ref]$probePoint)) {
        throw 'Cannot map smoke-test point to screen'
    }
    $probePacked = (($probePoint.Y -band 65535) -shl 16) -bor ($probePoint.X -band 65535)
    $probeResult = [UIntPtr]::Zero
    $probeSent = [WindowHitTest]::SendMessageTimeout($probeHandle, 0x84,
        [IntPtr]::Zero, [IntPtr]$probePacked, 2, 3000, [ref]$probeResult)
    if ($probeSent -eq [IntPtr]::Zero) { throw 'Window hit-test failed or timed out' }
    $probeResult.ToUInt64()
}
ConvertTo-Json -Compress -InputObject @($probeResults)
