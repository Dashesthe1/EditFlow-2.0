from __future__ import annotations

from pathlib import Path
import tempfile
import sys

from mcp.server.fastmcp import FastMCP, Image

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import ae_hands_core as hands

mcp = FastMCP("AE Hands")

@mcp.tool()
def ae_target() -> dict:
    """Return the single approved live After Effects window target."""
    return hands.resolve_ae_target().__dict__

@mcp.tool()
def ae_inspect_ui(depth: int = 6) -> str:
    """Return the live After Effects UI Automation tree."""
    root = Path(tempfile.gettempdir()) / "ae-hands-mcp"
    root.mkdir(parents=True, exist_ok=True)
    shot = root / "inspect-sidecar.png"
    tree = root / "ui-tree.txt"
    hands.observe(str(shot), str(tree), depth=max(1, min(depth, 12)))
    return tree.read_text(encoding="utf-8", errors="replace")

@mcp.tool()
def ae_screenshot() -> Image:
    """Capture and return the live After Effects window as an image."""
    root = Path(tempfile.gettempdir()) / "ae-hands-mcp"
    root.mkdir(parents=True, exist_ok=True)
    shot = root / "latest.png"
    hands.observe(str(shot), None, 1)
    return Image(data=shot.read_bytes(), format="png")

@mcp.tool()
def ae_click(x: float, y: float, button: str = "left", double: bool = False) -> dict:
    """Click normalized coordinates inside the After Effects window. x/y are 0..1."""
    return hands.click(x, y, button, double)

@mcp.tool()
def ae_drag(x1: float, y1: float, x2: float, y2: float, duration_ms: int = 350, button: str = "left") -> dict:
    """Drag between normalized coordinates inside After Effects."""
    return hands.drag(x1, y1, x2, y2, duration_ms, button)

@mcp.tool()
def ae_key(name: str) -> dict:
    """Press one named keyboard key while After Effects is foreground."""
    return hands.key(name)

@mcp.tool()
def ae_hotkey(keys: list[str]) -> dict:
    """Press a keyboard chord in After Effects, e.g. ['CTRL','Z']."""
    return hands.hotkey(keys)

@mcp.tool()
def ae_type(text: str) -> dict:
    """Type Unicode text into the currently focused After Effects control."""
    return hands.type_text(text)

@mcp.tool()
def ae_scroll(x: float, y: float, notches: int) -> dict:
    """Scroll the mouse wheel at normalized coordinates inside After Effects."""
    return hands.scroll(x, y, notches)

if __name__ == "__main__":
    mcp.run()
