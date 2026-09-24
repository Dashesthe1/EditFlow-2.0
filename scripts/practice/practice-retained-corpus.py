#!/usr/bin/env python3
import argparse
import hashlib
import json
import math
import re
from collections import Counter
from copy import deepcopy
from pathlib import Path

MANIFEST_SCHEMA = "editflow.practice-retained-truth-suite-manifest.v1"
INVENTORY_SCHEMA = "editflow.practice-retained-truth-corpus-inventory.v1"
ALLOWED_MODES = {"CERTIFICATION", "MEASURE_ONLY"}
ALLOWED_AUTHORITIES = {"INDEPENDENT_HUMAN", "INDEPENDENT_VERIFIER"}
ALLOWED_DIFFICULTIES = (
    "FAST_CUTS",
    "NEAR_DUPLICATE_SOURCES",
    "REVERSE_OR_REWIND",
    "LOW_INFORMATION",
    "STRONG_CAMERA_MOTION",
    "OCCLUSION",
    "IDENTITY_AMBIGUITY",
    "HEAVY_EFFECT_OBSCURATION",
    "REPEATED_SCENERY",
)
MIN_CASES = 20
MAX_CASES = 30
MIN_DIFFICULTY_KINDS = 4
MIN_DISTINCT_SOURCE_SETS = 3
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
PLACEHOLDER_OBSERVATION_REF = "practice-match-observation:not-yet-generated"


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def write_json(path, payload):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8", newline="\n")


def unique_nonempty(values):
    return list(dict.fromkeys(str(item).strip() for item in values or [] if str(item).strip()))


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_media_path(manifest_path, media_path):
    value = Path(str(media_path)).expanduser()
    if not value.is_absolute():
        value = Path(manifest_path).resolve().parent / value
    return str(value.resolve())


def require_manifest(path):
    payload = load_json(path)
    if payload.get("schema") != MANIFEST_SCHEMA:
        raise ValueError(f"{path}: unsupported retained truth-suite manifest schema.")
    if not isinstance(payload.get("editTypeId"), str) or not payload["editTypeId"].strip():
        raise ValueError(f"{path}: retained truth-suite manifest is missing editTypeId.")
    if payload.get("mode") not in ALLOWED_MODES:
        raise ValueError(f"{path}: retained truth-suite manifest has invalid mode.")
    if not isinstance(payload.get("cases"), list) or not payload["cases"]:
        raise ValueError(f"{path}: retained truth-suite manifest contains no cases.")
    return payload


def finite_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def coverage_fraction(truth):
    duration = truth.get("referenceDurationMs")
    shots = list(truth.get("shots") or [])
    if not finite_number(duration) or float(duration) <= 0 or not shots:
        return 0.0
    duration = float(duration)
    ranges = []
    for shot in shots:
        start = shot.get("referenceStartMs")
        end = shot.get("referenceEndMs")
        if not finite_number(start) or not finite_number(end):
            continue
        start = max(0.0, min(duration, float(start)))
        end = max(0.0, min(duration, float(end)))
        if end > start:
            ranges.append((start, end))
    ranges.sort()
    covered = 0.0
    active = None
    for start, end in ranges:
        if active is None:
            active = [start, end]
        elif start <= active[1]:
            active[1] = max(active[1], end)
        else:
            covered += active[1] - active[0]
            active = [start, end]
    if active is not None:
        covered += active[1] - active[0]
    return max(0.0, min(1.0, covered / duration))


def normalize_case(item, manifest_path):
    if not isinstance(item, dict):
        raise ValueError(f"{manifest_path}: retained corpus case must be an object.")
    truth = item.get("truth")
    observation = item.get("observation")
    if not isinstance(truth, dict) or not isinstance(observation, dict):
        raise ValueError(f"{manifest_path}: retained corpus case requires truth and observation objects.")
    case_id = str(truth.get("caseId", "")).strip() or "<unknown-case>"
    finish_path = resolve_media_path(manifest_path, item.get("finishPath", ""))
    if not Path(finish_path).is_file():
        raise ValueError(f"{case_id}: Finish media does not exist: {finish_path}")
    expected_finish_sha = str(truth.get("finishSha256", "")).strip().lower()
    if not SHA256_PATTERN.fullmatch(expected_finish_sha):
        raise ValueError(f"{case_id}: retained Finish SHA-256 is missing or malformed.")
    actual_finish_sha = sha256_file(finish_path)
    if actual_finish_sha != expected_finish_sha:
        raise ValueError(f"{case_id}: Finish media bytes do not match retained truth.")

    source_media = item.get("sourceMedia")
    if not isinstance(source_media, list) or not source_media:
        raise ValueError(f"{case_id}: retained corpus case has no Start source media.")
    normalized_sources = []
    actual_source_hashes = []
    for source in source_media:
        if not isinstance(source, dict):
            raise ValueError(f"{case_id}: sourceMedia entry must be an object.")
        source_path = resolve_media_path(manifest_path, source.get("path", ""))
        if not Path(source_path).is_file():
            raise ValueError(f"{case_id}: Start media does not exist: {source_path}")
        expected_sha = str(source.get("sha256", "")).strip().lower()
        if not SHA256_PATTERN.fullmatch(expected_sha):
            raise ValueError(f"{case_id}: retained Start SHA-256 is missing or malformed.")
        actual_sha = sha256_file(source_path)
        if actual_sha != expected_sha:
            raise ValueError(f"{case_id}: Start media bytes do not match retained truth.")
        normalized_sources.append({"path": source_path, "sha256": actual_sha})
        actual_source_hashes.append(actual_sha)

    truth_source_hashes = sorted(unique_nonempty(truth.get("sourceMediaSha256")))
    if any(not SHA256_PATTERN.fullmatch(value.lower()) for value in truth_source_hashes):
        raise ValueError(f"{case_id}: truth sourceMediaSha256 contains malformed values.")
    if sorted(set(value.lower() for value in truth_source_hashes)) != sorted(set(actual_source_hashes)):
        raise ValueError(f"{case_id}: Start media set does not match retained truth.")

    normalized = deepcopy(item)
    normalized["finishPath"] = finish_path
    normalized["sourceMedia"] = normalized_sources
    normalized["truth"]["finishSha256"] = actual_finish_sha
    normalized["truth"]["sourceMediaSha256"] = sorted(set(actual_source_hashes))
    return normalized


def case_preflight_reasons(item):
    truth = item["truth"]
    observation = item["observation"]
    case_id = str(truth.get("caseId", "")).strip()
    reasons = []
    if not case_id:
        reasons.append("Truth case id is empty.")
    if not str(truth.get("referenceId", "")).strip():
        reasons.append(f"{case_id or '<unknown-case>'}: Finish reference id is empty.")
    if truth.get("truthAuthority") not in ALLOWED_AUTHORITIES:
        reasons.append(f"{case_id or '<unknown-case>'}: truth is not independently authored or verified.")
    tags = unique_nonempty(truth.get("difficultyTags"))
    if not tags or any(tag not in ALLOWED_DIFFICULTIES for tag in tags):
        reasons.append(f"{case_id or '<unknown-case>'}: hard-case difficulty labels are missing or invalid.")
    if coverage_fraction(truth) < 0.98:
        reasons.append(f"{case_id or '<unknown-case>'}: retained shot truth covers less than 98% of Finish.")
    if not unique_nonempty(truth.get("evidenceRefs")):
        reasons.append(f"{case_id or '<unknown-case>'}: case truth has no independent evidence refs.")
    shots = list(truth.get("shots") or [])
    if not shots:
        reasons.append(f"{case_id or '<unknown-case>'}: case truth has no shot labels.")
    elif any(not unique_nonempty(shot.get("truthEvidenceRefs")) for shot in shots):
        reasons.append(f"{case_id or '<unknown-case>'}: at least one shot lacks independent evidence.")
    if str(observation.get("caseId", "")).strip() != case_id:
        reasons.append(f"{case_id or '<unknown-case>'}: observation case id does not match truth.")
    observation_refs = unique_nonempty(observation.get("evidenceRefs"))
    if not observation_refs or PLACEHOLDER_OBSERVATION_REF in observation_refs:
        reasons.append(f"{case_id or '<unknown-case>'}: real matcher observation evidence has not been retained.")
    return reasons


def build_inventory(edit_type_id, cases):
    case_ids = [str(item["truth"].get("caseId", "")).strip() for item in cases]
    reference_ids = [str(item["truth"].get("referenceId", "")).strip() for item in cases]
    finish_hashes = [str(item["truth"].get("finishSha256", "")).strip().lower() for item in cases]
    difficulty_counts = Counter(
        tag
        for item in cases
        for tag in unique_nonempty(item["truth"].get("difficultyTags"))
        if tag in ALLOWED_DIFFICULTIES
    )
    source_set_counts = Counter(
        "|".join(sorted(
            value.lower()
            for value in unique_nonempty(item["truth"].get("sourceMediaSha256"))
        ))
        for item in cases
    )
    reasons = []
    if len(cases) < MIN_CASES:
        reasons.append(f"Retained corpus has fewer than {MIN_CASES} cases.")
    if len(cases) > MAX_CASES:
        reasons.append(f"Retained corpus exceeds the supported {MAX_CASES}-case window.")
    if len(set(case_ids)) != len(cases):
        reasons.append("Retained corpus reuses a case id.")
    if len(set(reference_ids)) != len(cases):
        reasons.append("Retained corpus reuses a Finish reference id.")
    if len(set(finish_hashes)) != len(cases):
        reasons.append("Retained corpus reuses Finish byte identity (SHA-256).")
    if len(difficulty_counts) < MIN_DIFFICULTY_KINDS:
        reasons.append(f"Retained corpus spans fewer than {MIN_DIFFICULTY_KINDS} hard-case categories.")
    if len(source_set_counts) < MIN_DISTINCT_SOURCE_SETS:
        reasons.append(
            f"Retained corpus spans fewer than {MIN_DISTINCT_SOURCE_SETS} "
            "distinct content-addressed Start source sets."
        )
    for item in cases:
        reasons.extend(case_preflight_reasons(item))
    reasons = unique_nonempty(reasons)
    independent_count = sum(
        item["truth"].get("truthAuthority") in ALLOWED_AUTHORITIES for item in cases
    )
    full_truth_count = sum(coverage_fraction(item["truth"]) >= 0.98 for item in cases)
    observation_ready_count = sum(
        not case_preflight_reasons(item)
        or not any("observation evidence" in reason for reason in case_preflight_reasons(item))
        for item in cases
    )
    return {
        "schema": INVENTORY_SCHEMA,
        "editTypeId": edit_type_id,
        "caseCount": len(cases),
        "distinctCaseIdCount": len(set(case_ids)),
        "distinctReferenceCount": len(set(reference_ids)),
        "distinctFinishSha256Count": len(set(finish_hashes)),
        "distinctSourceSetCount": len(source_set_counts),
        "minimumDistinctSourceSets": MIN_DISTINCT_SOURCE_SETS,
        "sourceSetCounts": dict(sorted(source_set_counts.items())),
        "independentTruthCaseCount": independent_count,
        "fullLengthTruthCaseCount": full_truth_count,
        "observationReadyCaseCount": observation_ready_count,
        "difficultyKinds": [kind for kind in ALLOWED_DIFFICULTIES if difficulty_counts.get(kind, 0) > 0],
        "difficultyCounts": {kind: difficulty_counts.get(kind, 0) for kind in ALLOWED_DIFFICULTIES},
        "readyForCertificationRun": not reasons,
        "reasons": reasons,
    }


def assemble(manifest_paths, mode):
    if mode not in ALLOWED_MODES:
        raise ValueError("mode must be CERTIFICATION or MEASURE_ONLY")
    edit_type_id = None
    cases = []
    for manifest_path in manifest_paths:
        manifest = require_manifest(manifest_path)
        candidate_edit_type = manifest["editTypeId"].strip()
        if edit_type_id is None:
            edit_type_id = candidate_edit_type
        elif edit_type_id != candidate_edit_type:
            raise ValueError("Retained corpus manifests must use one Edit Type id.")
        cases.extend(normalize_case(item, manifest_path) for item in manifest["cases"])
    if edit_type_id is None:
        raise ValueError("At least one retained truth-suite manifest is required.")
    inventory = build_inventory(edit_type_id, cases)
    if mode == "CERTIFICATION" and not inventory["readyForCertificationRun"]:
        raise ValueError(
            "Retained corpus is not ready for a certification run:\n- "
            + "\n- ".join(inventory["reasons"])
        )
    return {
        "schema": MANIFEST_SCHEMA,
        "editTypeId": edit_type_id,
        "mode": mode,
        "cases": cases,
    }, inventory


def build_parser():
    parser = argparse.ArgumentParser(
        description="Assemble and preflight a 20-30 case retained Practice truth corpus."
    )
    sub = parser.add_subparsers(dest="command", required=True)

    inventory_parser = sub.add_parser("inventory")
    inventory_parser.add_argument("--manifest", action="append", required=True)
    inventory_parser.add_argument("--output")

    assemble_parser = sub.add_parser("assemble")
    assemble_parser.add_argument("--manifest", action="append", required=True)
    assemble_parser.add_argument("--mode", choices=sorted(ALLOWED_MODES), default="MEASURE_ONLY")
    assemble_parser.add_argument("--output", required=True)
    assemble_parser.add_argument("--inventory-output")
    return parser


def main():
    args = build_parser().parse_args()
    manifest, inventory = assemble(args.manifest, getattr(args, "mode", "MEASURE_ONLY"))
    if args.command == "inventory":
        if args.output:
            write_json(args.output, inventory)
        print(json.dumps(inventory, indent=2))
        return
    write_json(args.output, manifest)
    if args.inventory_output:
        write_json(args.inventory_output, inventory)
    print(json.dumps({
        "ok": True,
        "mode": manifest["mode"],
        "caseCount": inventory["caseCount"],
        "readyForCertificationRun": inventory["readyForCertificationRun"],
        "output": str(Path(args.output).resolve()),
    }))
if __name__ == "__main__":
    main()
