param(
  [Parameter(Mandatory = $true)][string]$AfterFxPath,
  [int]$TimeoutSeconds = 120
)
$ErrorActionPreference = "Stop"
$ArtifactDir = $env:EDITFLOW_PROOF_ARTIFACT_DIR
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class EFDesktopDiag {
  public const int UOI_NAME = 2;
  public const uint DESKTOP_READOBJECTS = 0x0001;
  [DllImport("kernel32.dll")] public static extern uint WTSGetActiveConsoleSessionId();
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern IntPtr GetProcessWindowStation();
  [DllImport("user32.dll")] public static extern IntPtr GetThreadDesktop(uint threadId);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint desiredAccess);
  [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool GetUserObjectInformation(IntPtr handle, int index, StringBuilder info, int length, out int needed);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  public static string NameOf(IntPtr handle) {
    if (handle == IntPtr.Zero) return null;
    int needed;
    GetUserObjectInformation(handle, UOI_NAME, null, 0, out needed);
    if (needed <= 0) return null;
    var sb = new StringBuilder(needed / 2 + 4);
    return GetUserObjectInformation(handle, UOI_NAME, sb, sb.Capacity * 2, out needed) ? sb.ToString() : null;
  }
}
"@
function Write-Result($classification,$message,$extra){$o=[ordered]@{classification=$classification;ok=($classification-eq'PASS');message=$message;mutationStarted=$false;cleanupComplete=$true;controlMode='DESKTOP_SESSION_DIAGNOSTIC';aeScriptingUsed=$false};foreach($k in $extra.Keys){$o[$k]=$extra[$k]};[IO.File]::WriteAllText((Join-Path $ArtifactDir 'result.json'),(($o|ConvertTo-Json -Depth 8)+[Environment]::NewLine))}
try {
  $self=[Diagnostics.Process]::GetCurrentProcess()
  $resolved=(Resolve-Path $AfterFxPath).Path
  $ae=@(Get-Process AfterFX -ErrorAction SilentlyContinue | Where-Object { try { [StringComparer]::OrdinalIgnoreCase.Equals((Resolve-Path $_.Path).Path,$resolved) } catch { $false } })
  if($ae.Count-ne1){throw "Expected one AE process, found $($ae.Count)."}
  $target=$ae[0]
  $explorer=@(Get-Process explorer -ErrorAction SilentlyContinue | ForEach-Object { [ordered]@{pid=$_.Id;sessionId=$_.SessionId} })
  $fg=[EFDesktopDiag]::GetForegroundWindow(); [uint32]$fgPid=0; [void][EFDesktopDiag]::GetWindowThreadProcessId($fg,[ref]$fgPid)
  $station=[EFDesktopDiag]::GetProcessWindowStation(); $threadDesk=[EFDesktopDiag]::GetThreadDesktop([EFDesktopDiag]::GetCurrentThreadId()); $inputDesk=[EFDesktopDiag]::OpenInputDesktop(0,$false,[EFDesktopDiag]::DESKTOP_READOBJECTS)
  try {
    $extra=@{
      currentPid=$self.Id; currentSessionId=$self.SessionId; aePid=$target.Id; aeSessionId=$target.SessionId;
      activeConsoleSessionId=[EFDesktopDiag]::WTSGetActiveConsoleSessionId(); explorerProcesses=$explorer;
      processWindowStationName=[EFDesktopDiag]::NameOf($station); currentThreadDesktopName=[EFDesktopDiag]::NameOf($threadDesk);
      inputDesktopOpened=($inputDesk-ne[IntPtr]::Zero); inputDesktopName=if($inputDesk-ne[IntPtr]::Zero){[EFDesktopDiag]::NameOf($inputDesk)}else{$null};
      foregroundPid=[int]$fgPid; userInteractive=[Environment]::UserInteractive; userName=[Environment]::UserName; machineName=[Environment]::MachineName
    }
    $sameSession=($self.SessionId-eq$target.SessionId)
    $sameActiveSession=($target.SessionId-eq[EFDesktopDiag]::WTSGetActiveConsoleSessionId())
    $extra['sameRunnerAndAeSession']=$sameSession; $extra['aeOnActiveConsoleSession']=$sameActiveSession
    Write-Result 'PASS' 'Captured runner, AE, active-console, window-station, and input-desktop identity without mutating AE.' $extra
    exit 0
  } finally { if($inputDesk-ne[IntPtr]::Zero){[void][EFDesktopDiag]::CloseDesktop($inputDesk)} }
} catch { Write-Result 'INFRASTRUCTURE_FAILURE' $_.Exception.Message @{}; exit 2 }
