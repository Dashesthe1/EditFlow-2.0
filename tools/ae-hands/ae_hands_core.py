from __future__ import annotations

import ctypes
from ctypes import wintypes
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass, asdict

USER32 = ctypes.windll.user32
try:
    USER32.SetProcessDPIAware()
except Exception:
    pass

INPUT_MOUSE = 0
INPUT_KEYBOARD = 1
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_UNICODE = 0x0004
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_RIGHTDOWN = 0x0008
MOUSEEVENTF_RIGHTUP = 0x0010
MOUSEEVENTF_MIDDLEDOWN = 0x0020
MOUSEEVENTF_MIDDLEUP = 0x0040
MOUSEEVENTF_WHEEL = 0x0800
WHEEL_DELTA = 120

ULONG_PTR = wintypes.WPARAM

class MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", wintypes.LONG),
        ("dy", wintypes.LONG),
        ("mouseData", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]

class KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", wintypes.WORD),
        ("wScan", wintypes.WORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]

class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [
        ("uMsg", wintypes.DWORD),
        ("wParamL", wintypes.WORD),
        ("wParamH", wintypes.WORD),
    ]

class INPUTUNION(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT), ("hi", HARDWAREINPUT)]

class INPUT(ctypes.Structure):
    _fields_ = [("type", wintypes.DWORD), ("u", INPUTUNION)]

class RECT(ctypes.Structure):
    _fields_ = [("left", wintypes.LONG), ("top", wintypes.LONG), ("right", wintypes.LONG), ("bottom", wintypes.LONG)]

@dataclass(frozen=True)
class AETarget:
    pid: int
    hwnd: int
    title: str
    left: int
    top: int
    width: int
    height: int

    def normalized_to_screen(self, x: float, y: float) -> tuple[int, int]:
        if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0):
            raise ValueError("normalized coordinates must be within [0,1]")
        px = self.left + int(round(x * max(0, self.width - 1)))
        py = self.top + int(round(y * max(0, self.height - 1)))
        return px, py

_KEY_MAP = {
    "SHIFT": 0x10, "CTRL": 0x11, "CONTROL": 0x11, "ALT": 0x12,
    "SPACE": 0x20, "ENTER": 0x0D, "RETURN": 0x0D, "ESC": 0x1B,
    "ESCAPE": 0x1B, "TAB": 0x09, "BACKSPACE": 0x08, "DELETE": 0x2E,
    "LEFT": 0x25, "UP": 0x26, "RIGHT": 0x27, "DOWN": 0x28,
    "HOME": 0x24, "END": 0x23, "PAGEUP": 0x21, "PAGEDOWN": 0x22,
    "F1": 0x70, "F2": 0x71, "F3": 0x72, "F4": 0x73, "F5": 0x74,
    "F6": 0x75, "F7": 0x76, "F8": 0x77, "F9": 0x78, "F10": 0x79,
    "F11": 0x7A, "F12": 0x7B,
}


def _powershell_json(script: str):
    proc = subprocess.run(
        ["powershell.exe", "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
        capture_output=True, text=True, timeout=10, check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"PowerShell target discovery failed: {proc.stderr.strip()}")
    text = proc.stdout.strip().lstrip("\ufeff")
    return json.loads(text) if text else None


def resolve_ae_target() -> AETarget:
    data = _powershell_json(
        "$ps=@(Get-Process AfterFX -ErrorAction SilentlyContinue | Where-Object {$_.Responding -and $_.MainWindowHandle -ne 0});"
        "if($ps.Count -ne 1){[pscustomobject]@{count=$ps.Count}|ConvertTo-Json -Compress;exit};"
        "$p=$ps[0];[pscustomobject]@{count=1;pid=$p.Id;hwnd=[int64]$p.MainWindowHandle;title=$p.MainWindowTitle}|ConvertTo-Json -Compress"
    )
    if not data or int(data.get("count", 0)) != 1:
        raise RuntimeError(f"Expected exactly one healthy AfterFX window; found {0 if not data else data.get('count')}")
    hwnd = int(data["hwnd"])
    rect = RECT()
    if not USER32.GetWindowRect(wintypes.HWND(hwnd), ctypes.byref(rect)):
        raise ctypes.WinError()
    return AETarget(
        pid=int(data["pid"]), hwnd=hwnd, title=str(data.get("title", "")),
        left=int(rect.left), top=int(rect.top), width=int(rect.right - rect.left), height=int(rect.bottom - rect.top),
    )


def _foreground_pid() -> int:
    hwnd = USER32.GetForegroundWindow()
    pid = wintypes.DWORD()
    USER32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    return int(pid.value)


def _winapp_path() -> str:
    path = shutil.which("winapp")
    if path:
        return path
    candidates = [
        Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Links" / "winapp.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WindowsApps" / "winapp.exe",
    ]
    for p in candidates:
        if p.is_file():
            return str(p)
    raise RuntimeError("winapp CLI is not installed or not on PATH")


def focus_ae(target: AETarget | None = None) -> AETarget:
    target = target or resolve_ae_target()
    USER32.SetForegroundWindow(wintypes.HWND(target.hwnd))
    time.sleep(0.25)
    if _foreground_pid() != target.pid:
        tmp = Path(tempfile.gettempdir()) / "ae-hands-focus.png"
        subprocess.run([_winapp_path(), "ui", "screenshot", "-w", str(target.hwnd), "--output", str(tmp), "--focus"], capture_output=True, text=True, timeout=15)
        time.sleep(0.25)
    if _foreground_pid() != target.pid:
        raise RuntimeError("Refusing input: After Effects is not the foreground process")
    return target


def _send_mouse(flags: int, data: int = 0):
    inp = INPUT(type=INPUT_MOUSE)
    inp.u.mi = MOUSEINPUT(0, 0, data, flags, 0, 0)
    sent = USER32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT))
    if sent != 1:
        raise ctypes.WinError()


def _send_key(vk: int, up: bool = False):
    inp = INPUT(type=INPUT_KEYBOARD)
    inp.u.ki = KEYBDINPUT(vk, 0, KEYEVENTF_KEYUP if up else 0, 0, 0)
    sent = USER32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT))
    if sent != 1:
        raise ctypes.WinError()


def _vk(name: str) -> int:
    key = name.upper()
    if key in _KEY_MAP:
        return _KEY_MAP[key]
    if len(key) == 1 and ("A" <= key <= "Z" or "0" <= key <= "9"):
        return ord(key)
    raise ValueError(f"Unsupported key: {name}")


def _button_flags(button: str) -> tuple[int, int]:
    b = button.lower()
    if b == "left": return MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP
    if b == "right": return MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP
    if b == "middle": return MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP
    raise ValueError("button must be left, right, or middle")


def click(x: float, y: float, button: str = "left", double: bool = False) -> dict:
    target = focus_ae()
    sx, sy = target.normalized_to_screen(x, y)
    if not USER32.SetCursorPos(sx, sy):
        raise ctypes.WinError()
    time.sleep(0.05)
    down, up = _button_flags(button)
    for _ in range(2 if double else 1):
        _send_mouse(down); _send_mouse(up); time.sleep(0.08)
    return {"ok": True, "target": asdict(target), "screen": {"x": sx, "y": sy}, "button": button, "double": double}


def drag(x1: float, y1: float, x2: float, y2: float, duration_ms: int = 350, button: str = "left") -> dict:
    if duration_ms < 0 or duration_ms > 10000:
        raise ValueError("duration_ms must be between 0 and 10000")
    target = focus_ae()
    sx1, sy1 = target.normalized_to_screen(x1, y1)
    sx2, sy2 = target.normalized_to_screen(x2, y2)
    USER32.SetCursorPos(sx1, sy1); time.sleep(0.05)
    down, up = _button_flags(button)
    _send_mouse(down)
    steps = max(2, min(120, int(max(1, duration_ms) / 12)))
    delay = (duration_ms / 1000.0) / steps if steps else 0
    try:
        for i in range(1, steps + 1):
            t = i / steps
            USER32.SetCursorPos(int(round(sx1 + (sx2 - sx1) * t)), int(round(sy1 + (sy2 - sy1) * t)))
            if delay: time.sleep(delay)
    finally:
        _send_mouse(up)
    return {"ok": True, "target": asdict(target), "from": {"x": sx1, "y": sy1}, "to": {"x": sx2, "y": sy2}, "duration_ms": duration_ms}


def hotkey(keys: list[str]) -> dict:
    if not keys:
        raise ValueError("keys may not be empty")
    target = focus_ae()
    vks = [_vk(k) for k in keys]
    for vk in vks: _send_key(vk, False)
    for vk in reversed(vks): _send_key(vk, True)
    time.sleep(0.08)
    return {"ok": True, "target": asdict(target), "keys": keys}


def key(name: str) -> dict:
    return hotkey([name])


def type_text(text: str) -> dict:
    target = focus_ae()
    for ch in text:
        codepoint = ord(ch)
        for up in (False, True):
            inp = INPUT(type=INPUT_KEYBOARD)
            flags = KEYEVENTF_UNICODE | (KEYEVENTF_KEYUP if up else 0)
            inp.u.ki = KEYBDINPUT(0, codepoint, flags, 0, 0)
            sent = USER32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT))
            if sent != 1: raise ctypes.WinError()
    return {"ok": True, "target": asdict(target), "characters": len(text)}


def scroll(x: float, y: float, notches: int) -> dict:
    target = focus_ae()
    sx, sy = target.normalized_to_screen(x, y)
    USER32.SetCursorPos(sx, sy); time.sleep(0.05)
    _send_mouse(MOUSEEVENTF_WHEEL, int(notches * WHEEL_DELTA) & 0xFFFFFFFF)
    return {"ok": True, "target": asdict(target), "notches": notches, "screen": {"x": sx, "y": sy}}


def observe(screenshot_path: str, ui_tree_path: str | None = None, depth: int = 6) -> dict:
    target = resolve_ae_target()
    winapp = _winapp_path()
    shot = Path(screenshot_path).resolve()
    shot.parent.mkdir(parents=True, exist_ok=True)
    cmd = [winapp, "ui", "screenshot", "-w", str(target.hwnd), "--output", str(shot), "--focus"]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=20, check=False)
    if proc.returncode != 0 or not shot.is_file():
        raise RuntimeError(f"winapp screenshot failed: {proc.stdout}\n{proc.stderr}")
    tree_info = None
    if ui_tree_path:
        tree = Path(ui_tree_path).resolve(); tree.parent.mkdir(parents=True, exist_ok=True)
        insp = subprocess.run([winapp, "ui", "inspect", "-w", str(target.hwnd), "--depth", str(depth)], capture_output=True, text=True, timeout=20, check=False)
        tree.write_text((insp.stdout or "") + ("\n" + insp.stderr if insp.stderr else ""), encoding="utf-8")
        tree_info = {"path": str(tree), "bytes": tree.stat().st_size, "returncode": insp.returncode}
    return {"ok": True, "target": asdict(target), "screenshot": {"path": str(shot), "bytes": shot.stat().st_size}, "ui_tree": tree_info}
