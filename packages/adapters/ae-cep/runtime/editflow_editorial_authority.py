"""Local model decision drivers are historical acceptance-lab support only."""
import os

def require_isolated_legacy_driver():
    if os.environ.get("EDITFLOW_EDIT_DECISION_AUTHORITY") == "CHATGPT_DIRECT" or os.environ.get("EDITFLOW_ISOLATED_LEGACY_TEST") != "1":
        raise RuntimeError("LOCAL_MODEL_DECISIONS_RETIRED: ChatGPT must directly inspect native state and supply exact operations. This driver is available only in an explicitly isolated legacy lab.")
