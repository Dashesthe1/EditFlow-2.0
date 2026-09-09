from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import ae_hands_core as hands


def emit(obj):
    print(json.dumps(obj, indent=2))


def main():
    p = argparse.ArgumentParser(description="AE-scoped human input primitives")
    sub = p.add_subparsers(dest="cmd", required=True)

    o = sub.add_parser("observe")
    o.add_argument("--screenshot", required=True)
    o.add_argument("--tree")
    o.add_argument("--depth", type=int, default=6)

    c = sub.add_parser("click")
    c.add_argument("x", type=float); c.add_argument("y", type=float)
    c.add_argument("--button", default="left", choices=["left", "right", "middle"])
    c.add_argument("--double", action="store_true")

    d = sub.add_parser("drag")
    d.add_argument("x1", type=float); d.add_argument("y1", type=float)
    d.add_argument("x2", type=float); d.add_argument("y2", type=float)
    d.add_argument("--duration-ms", type=int, default=350)
    d.add_argument("--button", default="left", choices=["left", "right", "middle"])

    k = sub.add_parser("key")
    k.add_argument("name")

    h = sub.add_parser("hotkey")
    h.add_argument("keys", nargs="+")

    t = sub.add_parser("type")
    t.add_argument("text")

    s = sub.add_parser("scroll")
    s.add_argument("x", type=float); s.add_argument("y", type=float); s.add_argument("notches", type=int)

    target = sub.add_parser("target")

    args = p.parse_args()
    if args.cmd == "observe": emit(hands.observe(args.screenshot, args.tree, args.depth))
    elif args.cmd == "click": emit(hands.click(args.x, args.y, args.button, args.double))
    elif args.cmd == "drag": emit(hands.drag(args.x1, args.y1, args.x2, args.y2, args.duration_ms, args.button))
    elif args.cmd == "key": emit(hands.key(args.name))
    elif args.cmd == "hotkey": emit(hands.hotkey(args.keys))
    elif args.cmd == "type": emit(hands.type_text(args.text))
    elif args.cmd == "scroll": emit(hands.scroll(args.x, args.y, args.notches))
    elif args.cmd == "target": emit(hands.resolve_ae_target().__dict__)


if __name__ == "__main__":
    main()
