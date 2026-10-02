param(
  [string]$Reason = "heartbeat_stale"
)

$ErrorActionPreference = "SilentlyContinue"
$root = "C:\Users\Shadow\AppData\Local\EditFlow2\chat-supervisor"
$log = Join-Path $root "recovery.log"
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$extensionId = "ljjjjjoghmheifakiiahgoonhhmoebog"

function Log-Line([string]$Message) {
  $stamp = (Get-Date).ToString("o")
  Add-Content -Path $log -Value "$stamp $Message"
}

Log-Line "recovery-start reason=$Reason"
$loadedBefore = 0
try { $loadedBefore = (Invoke-RestMethod 'http://127.0.0.1:32147/health' -TimeoutSec 2).lastExtensionLoadedAt } catch {}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class EditFlowWatchdogReloadMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(int flags, int x, int y, int buttons, int extra);
}
'@


if (-not (Get-Process chrome -ErrorAction SilentlyContinue)) {
  Start-Process $chrome "https://chatgpt.com/"
  Start-Sleep -Seconds 4
  Log-Line "chrome-started"
}

# chrome:// pages are not reliably opened through Start-Process when Chrome is
# already running. Open a temporary browser tab from inside Chrome instead.
$ws = New-Object -ComObject WScript.Shell
$activated = $ws.AppActivate("Google Chrome")
if ($activated) {
  Start-Sleep -Milliseconds 250
  $ws.SendKeys("^t")
  Start-Sleep -Milliseconds 250
  $ws.SendKeys("chrome://extensions/?id=$extensionId")
  $ws.SendKeys("{ENTER}")
} else {
  Log-Line "extension-reload chrome-window-activation-failed"
}
Start-Sleep -Seconds 2

Add-Type -AssemblyName UIAutomationClient
$clicked = $false
$deadline = [DateTimeOffset]::UtcNow.AddSeconds(15)
while (-not $clicked -and [DateTimeOffset]::UtcNow -lt $deadline) {
  $uiRoot = [System.Windows.Automation.AutomationElement]::RootElement
  $windows = $uiRoot.FindAll([System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($window in $windows) {
    # Only the observed extension details surface, never another Chrome tab.
    if ($window.Current.Name -notlike '*Extensions*ChatGPT Production Watchdog*Google Chrome*') { continue }
    $buttonCondition = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Button)
    $buttons = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
    foreach ($button in $buttons) {
      if ($button.Current.Name -ne 'Reload' -or $button.Current.BoundingRectangle.Y -lt 150) { continue }
      try {
        $pattern = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $pattern.Invoke()
        Start-Sleep -Milliseconds 750
        $loaded = (Invoke-RestMethod 'http://127.0.0.1:32147/health' -TimeoutSec 2).lastExtensionLoadedAt
        if ($loaded -le $loadedBefore) {
          # InvokePattern can report success without reloading this Chrome
          # extension. Use the observed details-page Reload rectangle.
          $r = $button.Current.BoundingRectangle
          [EditFlowWatchdogReloadMouse]::SetCursorPos([int]($r.X + $r.Width/2), [int]($r.Y + $r.Height/2)) | Out-Null
          [EditFlowWatchdogReloadMouse]::mouse_event(2,0,0,0,0)
          [EditFlowWatchdogReloadMouse]::mouse_event(4,0,0,0,0)
          Start-Sleep -Milliseconds 750
          $loaded = (Invoke-RestMethod 'http://127.0.0.1:32147/health' -TimeoutSec 2).lastExtensionLoadedAt
        }
        $clicked = $loaded -gt $loadedBefore
        if ($clicked) { break }
      } catch {}
    }
    if ($clicked) { break }
  }
  if (-not $clicked) { Start-Sleep -Milliseconds 500 }
}

Log-Line "extension-reload clicked=$clicked"
Start-Sleep -Seconds 2

# Recovery must never steal a live Practice session by opening another ChatGPT
# surface. Close the temporary Extensions tab after a successful reload and
# leave every existing ChatGPT tab exactly where it was.
if ($clicked) {
  try {
    $ws = New-Object -ComObject WScript.Shell
    $ws.SendKeys("^w")
    Log-Line "extensions-tab-closed"
  } catch {}
}
Log-Line "recovery-complete existing-chat-tabs-unchanged"

if (-not $clicked) { throw 'Watchdog extension reload was not confirmed; monitoring recovery must retry.' }
