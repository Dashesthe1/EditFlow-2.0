param([string]$Python = "", [switch]$CpuOnly)
$ErrorActionPreference = "Stop"
$DataRoot = Join-Path $env:LOCALAPPDATA "EditFlow2"
$Venv = Join-Path $DataRoot "source-match-venv"
if (-not (Test-Path (Join-Path $Venv "Scripts\python.exe"))) {
  if ($Python) { & $Python -m venv $Venv } else { & py -3.12 -m venv $Venv }
  if ($LASTEXITCODE) { throw "Python 3.12 virtual environment failed" }
}
$RuntimePython = Join-Path $Venv "Scripts\python.exe"
$TorchIndex = if ($CpuOnly) { "https://download.pytorch.org/whl/cpu" } else { "https://download.pytorch.org/whl/cu124" }
& $RuntimePython -m pip install "torch==2.6.0" --index-url $TorchIndex
if ($LASTEXITCODE) { throw "PyTorch install failed" }
& $RuntimePython -m pip install -r (Join-Path $PSScriptRoot "requirements.txt")
if ($LASTEXITCODE) { throw "Media dependency install failed" }
& $RuntimePython (Join-Path $PSScriptRoot "setup.py") --data-root $DataRoot $(if ($CpuOnly) { "--cpu" })
if ($LASTEXITCODE) { throw "Model download/runtime verification failed" }
