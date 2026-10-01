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
        $clicked = $true
        break
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
