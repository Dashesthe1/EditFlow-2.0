from pathlib import Path


def test_current_shadow_gateway_keeps_legacy_introspection_alias():
    root = Path(__file__).resolve().parents[1]
    source = (root / "scripts" / "current_shadow_gateway_v3.py").read_text(encoding="utf-8")
    assert "def list_adaptive_capabilities()" in source
    assert '"compatibilityAlias": True' in source
    assert '"CONTINUOUS_FAST_LOOP"' in source
    assert '"ROUTINE_DECISION_ENGINE"' in source
