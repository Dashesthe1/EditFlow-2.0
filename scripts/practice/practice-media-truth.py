#!/usr/bin/env python3
import argparse
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path

TRUTH_SCHEMA = "editflow.practice-media-benchmark-truth.v1"
REFERENCE_SCHEMA = "editflow.practice-reference-analysis.v1"
DRAFT_STATUS = "DRAFT"
RETAINED_STATUS = "RETAINED"
ALLOWED_ORIGINS = {"INDEPENDENT_HUMAN", "INDEPENDENT_EXTERNAL_TOOL"}
ALLOWED_DIRECTIONS = {"FORWARD", "REVERSE"}
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def write_json(path, payload):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8", newline="\n")


def now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def require_reference(path):
    payload = load_json(path)
    if payload.get("schema") != REFERENCE_SCHEMA:
        raise ValueError(f"Reference analysis must use {REFERENCE_SCHEMA}")
    shots = list(payload.get("shots") or [])
    if not shots:
        raise ValueError("Reference analysis contains no shots.")
    return payload


def normalize_source_sha256_map(value):
    if not isinstance(value, dict):
        return {}
    return {
        str(source_id).strip(): str(source_sha256).strip().lower()
        for source_id, source_sha256 in value.items()
        if str(source_id).strip() and str(source_sha256).strip()
    }


def parse_source_sha256_args(values):
    result = {}
    for item in values or []:
        if "=" not in str(item):
            raise ValueError("--source-sha256 must use SOURCE_ID=SHA256")
        source_id, source_sha256 = str(item).split("=", 1)
        source_id = source_id.strip()
        source_sha256 = source_sha256.strip().lower()
        if not source_id or not source_sha256:
            raise ValueError("--source-sha256 must use non-empty SOURCE_ID=SHA256")
        if not SHA256_PATTERN.fullmatch(source_sha256):
            raise ValueError("--source-sha256 must contain an exact 64-character SHA-256")
        prior = result.get(source_id)
        if prior is not None and prior != source_sha256:
            raise ValueError(f"Conflicting SHA-256 bindings for source ID {source_id}")
        result[source_id] = source_sha256
    return result


def require_source_sha256_bindings(source_ids, value):
    source_set = {str(item).strip() for item in source_ids if str(item).strip()}
    bindings = normalize_source_sha256_map(value)
    if set(bindings) != source_set:
        raise ValueError("Source SHA-256 bindings must cover the exact source-ID set.")
    invalid = sorted(
        source_id
        for source_id, source_sha256 in bindings.items()
        if not SHA256_PATTERN.fullmatch(source_sha256)
    )
    if invalid:
        raise ValueError(
            "Source SHA-256 bindings must contain exact 64-character hashes: "
            + ", ".join(invalid)
        )
    return bindings


def scaffold(reference, source_ids, source_sha256_by_id):
    source_ids = sorted({str(item).strip() for item in source_ids if str(item).strip()})
    if not source_ids:
        raise ValueError("At least one allowed source ID is required.")
    source_sha256_by_id = require_source_sha256_bindings(source_ids, source_sha256_by_id)
    shots = []
    for item in reference.get("shots") or []:
        shots.append({
            "shotId": str(item["shotId"]),
            "referenceStartMs": float(item["referenceStartMs"]),
            "referenceEndMs": float(item["referenceEndMs"]),
            "sourceId": None,
            "sourceStartMs": None,
            "sourceEndMs": None,
            "direction": None,
            "toleranceMs": None,
            "minimumIou": 0.50,
            "notes": "",
        })
    return {
        "schema": TRUTH_SCHEMA,
        "status": DRAFT_STATUS,
        "referenceId": str(reference["referenceId"]),
        "referenceFingerprint": str(reference.get("styleFingerprint", "")),
        "referenceSourceSha256": str(reference.get("sourceSha256", "")),
        "referenceAnalyzerFingerprint": str(
            (reference.get("analysis") or {}).get("analyzerFingerprint", "")
        ),
        "allowedSourceIds": source_ids,
        "allowedSourceSha256": source_sha256_by_id,
        "annotationOrigin": None,
        "createdAt": now_iso(),
        "retainedAt": None,
        "policy": {
            "matcherSuggestionsAllowed": False,
            "matcherOutputMayBecomeTruth": False,
            "instruction": (
                "Annotate source identity, source range, and playback direction independently. "
                "Do not copy EditFlow matcher predictions into this file."
            ),
        },
        "shots": shots,
    }


def finite_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def validate_truth(
    truth,
    reference,
    allowed_source_ids=None,
    allowed_source_sha256_by_id=None,
    require_retained=False,
):
    errors = []
    if truth.get("schema") != TRUTH_SCHEMA:
        errors.append(f"schema must be {TRUTH_SCHEMA}")
    if str(truth.get("referenceId")) != str(reference.get("referenceId")):
        errors.append("referenceId does not match the reference analysis.")
    expected_style = str(reference.get("styleFingerprint", ""))
    if expected_style and str(truth.get("referenceFingerprint", "")) != expected_style:
        errors.append("referenceFingerprint does not match the exact Finish analysis.")
    expected_source_sha = str(reference.get("sourceSha256", ""))
    if expected_source_sha and str(truth.get("referenceSourceSha256", "")) != expected_source_sha:
        errors.append("referenceSourceSha256 does not match the exact Finish media.")
    expected_analyzer = str((reference.get("analysis") or {}).get("analyzerFingerprint", ""))
    if expected_analyzer and str(truth.get("referenceAnalyzerFingerprint", "")) != expected_analyzer:
        errors.append("referenceAnalyzerFingerprint is stale; re-annotate against current analysis.")
    if truth.get("annotationOrigin") not in ALLOWED_ORIGINS:
        errors.append("annotationOrigin must be independent of EditFlow matching.")
    if require_retained and truth.get("status") != RETAINED_STATUS:
        errors.append("truth status must be RETAINED.")

    reference_ids = [str(item["shotId"]) for item in reference.get("shots") or []]
    rows = list(truth.get("shots") or [])
    row_ids = [str(item.get("shotId")) for item in rows]
    if row_ids != reference_ids:
        errors.append("truth shots must cover every reference shot exactly once in reference order.")

    manifest_sources = {
        str(item).strip()
        for item in (allowed_source_ids if allowed_source_ids is not None else truth.get("allowedSourceIds") or [])
        if str(item).strip()
    }
    if not manifest_sources:
        errors.append("at least one allowed source ID is required.")
    declared_sources = {
        str(item).strip()
        for item in truth.get("allowedSourceIds") or []
        if str(item).strip()
    }
    if declared_sources != manifest_sources:
        errors.append("allowedSourceIds must exactly match the benchmark source set.")

    raw_declared_hashes = truth.get("allowedSourceSha256")
    if raw_declared_hashes is not None and not isinstance(raw_declared_hashes, dict):
        errors.append("allowedSourceSha256 must be an object keyed by source ID.")
    declared_hashes = normalize_source_sha256_map(raw_declared_hashes)
    invalid_declared_hashes = sorted(
        source_id
        for source_id, source_sha256 in declared_hashes.items()
        if not SHA256_PATTERN.fullmatch(source_sha256)
    )
    if invalid_declared_hashes:
        errors.append(
            "allowedSourceSha256 contains malformed SHA-256 values for: "
            + ", ".join(invalid_declared_hashes)
        )
    if require_retained and set(declared_hashes) != declared_sources:
        errors.append(
            "allowedSourceSha256 must bind every retained source ID to its exact media SHA-256."
        )
    expected_hashes = normalize_source_sha256_map(allowed_source_sha256_by_id)
    if allowed_source_sha256_by_id is not None:
        if set(expected_hashes) != manifest_sources:
            errors.append("benchmark source SHA-256 bindings must cover the exact source set.")
        elif any(not SHA256_PATTERN.fullmatch(value) for value in expected_hashes.values()):
            errors.append("benchmark source SHA-256 bindings contain malformed hashes.")
        elif declared_hashes != expected_hashes:
            errors.append(
                "allowedSourceSha256 does not match the exact benchmark Start media bytes."
            )

    for index, row in enumerate(rows):
        shot_id = str(row.get("shotId", f"index:{index}"))
        source_id = row.get("sourceId")
        if not isinstance(source_id, str) or source_id not in manifest_sources:
            errors.append(f"{shot_id}: sourceId must be one of the allowed source IDs.")
        start = row.get("sourceStartMs")
        end = row.get("sourceEndMs")
        if not finite_number(start) or float(start) < 0:
            errors.append(f"{shot_id}: sourceStartMs must be a finite non-negative number.")
        if not finite_number(end) or float(end) < 0:
            errors.append(f"{shot_id}: sourceEndMs must be a finite non-negative number.")
        if finite_number(start) and finite_number(end) and float(end) <= float(start):
            errors.append(
                f"{shot_id}: sourceEndMs must be greater than sourceStartMs; "
                "playback direction is stored separately."
            )
        if row.get("direction") not in ALLOWED_DIRECTIONS:
            errors.append(f"{shot_id}: direction must be FORWARD or REVERSE.")
        tolerance = row.get("toleranceMs")
        if tolerance is not None and (not finite_number(tolerance) or float(tolerance) <= 0):
            errors.append(f"{shot_id}: toleranceMs must be null or a finite positive number.")
        minimum_iou = row.get("minimumIou", 0.50)
        if not finite_number(minimum_iou) or not 0 < float(minimum_iou) <= 1:
            errors.append(f"{shot_id}: minimumIou must be in (0, 1].")
    return errors


def retain(
    draft,
    reference,
    allowed_source_ids,
    allowed_source_sha256_by_id,
    annotation_origin,
):
    source_ids = sorted(
        {str(item).strip() for item in allowed_source_ids if str(item).strip()}
    )
    source_sha256_by_id = require_source_sha256_bindings(
        source_ids,
        allowed_source_sha256_by_id,
    )
    value = json.loads(json.dumps(draft))
    value["annotationOrigin"] = annotation_origin
    value["allowedSourceIds"] = source_ids
    value["allowedSourceSha256"] = source_sha256_by_id
    value["status"] = RETAINED_STATUS
    value["retainedAt"] = now_iso()
    errors = validate_truth(
        value,
        reference,
        allowed_source_ids=source_ids,
        allowed_source_sha256_by_id=source_sha256_by_id,
        require_retained=True,
    )
    if errors:
        raise ValueError("Truth cannot be retained:\n- " + "\n- ".join(errors))
    return value


def build_parser():
    parser = argparse.ArgumentParser(
        description="Scaffold and retain independent shot truth for Practice real-media benchmarks."
    )
    sub = parser.add_subparsers(dest="command", required=True)

    scaffold_parser = sub.add_parser("scaffold")
    scaffold_parser.add_argument("--reference-analysis", required=True)
    scaffold_parser.add_argument("--source-id", action="append", required=True)
    scaffold_parser.add_argument("--source-sha256", action="append", required=True)
    scaffold_parser.add_argument("--output", required=True)

    validate_parser = sub.add_parser("validate")
    validate_parser.add_argument("--reference-analysis", required=True)
    validate_parser.add_argument("--truth", required=True)
    validate_parser.add_argument("--source-id", action="append")
    validate_parser.add_argument("--source-sha256", action="append", required=True)
    validate_parser.add_argument("--require-retained", action="store_true")

    retain_parser = sub.add_parser("retain")
    retain_parser.add_argument("--reference-analysis", required=True)
    retain_parser.add_argument("--draft", required=True)
    retain_parser.add_argument("--source-id", action="append", required=True)
    retain_parser.add_argument("--source-sha256", action="append", required=True)
    retain_parser.add_argument("--annotation-origin", choices=sorted(ALLOWED_ORIGINS), required=True)
    retain_parser.add_argument("--output", required=True)
    return parser


def main():
    args = build_parser().parse_args()
    reference = require_reference(args.reference_analysis)

    if args.command == "scaffold":
        source_sha256_by_id = parse_source_sha256_args(args.source_sha256)
        payload = scaffold(reference, args.source_id, source_sha256_by_id)
        write_json(args.output, payload)
        print(json.dumps({"ok": True, "status": DRAFT_STATUS, "output": str(Path(args.output).resolve())}))
        return

    if args.command == "validate":
        truth = load_json(args.truth)
        source_sha256_by_id = parse_source_sha256_args(args.source_sha256)
        errors = validate_truth(
            truth,
            reference,
            allowed_source_ids=args.source_id,
            allowed_source_sha256_by_id=source_sha256_by_id,
            require_retained=args.require_retained,
        )
        print(json.dumps({"ok": not errors, "errors": errors}))
        if errors:
            raise SystemExit(2)
        return

    if args.command == "retain":
        draft = load_json(args.draft)
        source_sha256_by_id = parse_source_sha256_args(args.source_sha256)
        payload = retain(
            draft,
            reference,
            args.source_id,
            source_sha256_by_id,
            args.annotation_origin,
        )
        write_json(args.output, payload)
        print(json.dumps({"ok": True, "status": RETAINED_STATUS, "output": str(Path(args.output).resolve())}))
        return

    raise RuntimeError("Unsupported command.")


if __name__ == "__main__":
    main()
