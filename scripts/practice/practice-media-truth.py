#!/usr/bin/env python3
import argparse
import csv
import hashlib
import json
import math
import os
import re
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path

TRUTH_SCHEMA = "editflow.practice-media-benchmark-truth.v1"
REFERENCE_SCHEMA = "editflow.practice-reference-analysis.v1"
DRAFT_STATUS = "DRAFT"
RETAINED_STATUS = "RETAINED"
ALLOWED_ORIGINS = {"INDEPENDENT_HUMAN", "INDEPENDENT_EXTERNAL_TOOL"}
ALLOWED_DIRECTIONS = {"FORWARD", "REVERSE"}
RETAINED_SUITE_MANIFEST_SCHEMA = "editflow.practice-retained-truth-suite-manifest.v1"
MATCH_SCHEMA = "editflow.practice-scene-matches.v1"
ALLOWED_DIFFICULTIES = {
    "FAST_CUTS",
    "NEAR_DUPLICATE_SOURCES",
    "REVERSE_OR_REWIND",
    "LOW_INFORMATION",
    "STRONG_CAMERA_MOTION",
    "OCCLUSION",
    "IDENTITY_AMBIGUITY",
    "HEAVY_EFFECT_OBSCURATION",
    "REPEATED_SCENERY",
}
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_SHA256_FILE_CACHE = {}


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


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_file_cached(path):
    resolved = Path(path).expanduser().resolve()
    stat = resolved.stat()
    cache_key = (str(resolved), int(stat.st_size), int(stat.st_mtime_ns))
    cached = _SHA256_FILE_CACHE.get(cache_key)
    if cached is not None:
        return cached
    stale_keys = [
        key for key in _SHA256_FILE_CACHE
        if key[0] == str(resolved) and key != cache_key
    ]
    for key in stale_keys:
        _SHA256_FILE_CACHE.pop(key, None)
    digest = sha256_file(resolved)
    _SHA256_FILE_CACHE[cache_key] = digest
    return digest


def parse_source_path_args(values):
    result = {}
    for item in values or []:
        if "=" not in str(item):
            raise ValueError("--source must use SOURCE_ID=PATH")
        source_id, source_path = str(item).split("=", 1)
        source_id = source_id.strip()
        source_path = source_path.strip()
        if not source_id or not source_path:
            raise ValueError("--source must use non-empty SOURCE_ID=PATH")
        resolved = str(Path(source_path).expanduser().resolve())
        prior = result.get(source_id)
        if prior is not None and prior != resolved:
            raise ValueError(f"Conflicting paths for source ID {source_id}")
        result[source_id] = resolved
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
    draft_source_sha256_by_id = require_source_sha256_bindings(
        source_ids,
        draft.get("allowedSourceSha256"),
    )
    if draft_source_sha256_by_id != source_sha256_by_id:
        raise ValueError(
            "Start media bytes changed since this truth draft was scaffolded; "
            "re-scaffold and re-annotate against the current media."
        )
    value = json.loads(json.dumps(draft))
    value["annotationOrigin"] = annotation_origin
    value["allowedSourceIds"] = source_ids
    value["allowedSourceSha256"] = draft_source_sha256_by_id
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


def build_retained_suite_manifest(
    truth,
    reference,
    finish_path,
    source_paths_by_id,
    case_id,
    edit_type_id,
    difficulty_tags,
    truth_evidence_sha256,
    reference_evidence_sha256,
    observation=None,
    observation_evidence_sha256=None,
):
    source_ids = sorted(
        {str(item).strip() for item in truth.get("allowedSourceIds") or [] if str(item).strip()}
    )
    expected_hashes = require_source_sha256_bindings(
        source_ids,
        truth.get("allowedSourceSha256"),
    )
    errors = validate_truth(
        truth,
        reference,
        allowed_source_ids=source_ids,
        allowed_source_sha256_by_id=expected_hashes,
        require_retained=True,
    )
    if errors:
        raise ValueError("Retained truth is invalid:\n- " + "\n- ".join(errors))
    if set(source_paths_by_id) != set(source_ids):
        raise ValueError("Source paths must cover the exact retained source-ID set.")

    finish_path = str(Path(finish_path).expanduser().resolve())
    finish_sha256 = sha256_file(finish_path)
    expected_finish_sha256 = str(truth.get("referenceSourceSha256", "")).strip().lower()
    if finish_sha256 != expected_finish_sha256:
        raise ValueError("Finish media bytes do not match retained independent truth.")

    source_media = []
    source_hashes = []
    for source_id in source_ids:
        source_path = str(Path(source_paths_by_id[source_id]).expanduser().resolve())
        source_sha256 = sha256_file(source_path)
        if source_sha256 != expected_hashes[source_id]:
            raise ValueError(
                f"Start media bytes do not match retained truth for source ID {source_id}."
            )
        source_media.append({"path": source_path, "sha256": source_sha256})
        source_hashes.append(source_sha256)

    tags = list(dict.fromkeys(str(item).strip() for item in difficulty_tags if str(item).strip()))
    if not tags or any(item not in ALLOWED_DIFFICULTIES for item in tags):
        raise ValueError("At least one supported retained-truth difficulty tag is required.")
    authority = (
        "INDEPENDENT_HUMAN"
        if truth.get("annotationOrigin") == "INDEPENDENT_HUMAN"
        else "INDEPENDENT_VERIFIER"
    )
    reference_shots = list(reference.get("shots") or [])
    truth_by_id = {str(item["shotId"]): item for item in truth.get("shots") or []}
    retained_shots = []
    for order, reference_shot in enumerate(reference_shots):
        shot_id = str(reference_shot["shotId"])
        row = truth_by_id[shot_id]
        shot_truth = {
            "shotId": shot_id,
            "order": order,
            "referenceStartMs": float(reference_shot["referenceStartMs"]),
            "referenceEndMs": float(reference_shot["referenceEndMs"]),
            "expectedSourceId": str(row["sourceId"]),
            "expectedSourceStartMs": float(row["sourceStartMs"]),
            "expectedSourceEndMs": float(row["sourceEndMs"]),
            "expectedDirection": str(row["direction"]),
            "truthEvidenceRefs": [
                f"independent-truth:sha256:{truth_evidence_sha256}:shot:{shot_id}",
            ],
        }
        if row.get("toleranceMs") is not None:
            shot_truth["sourceToleranceMs"] = float(row["toleranceMs"])
        retained_shots.append(shot_truth)

    duration_ms = float(
        (reference.get("video") or {}).get(
            "durationMs",
            max(float(item["referenceEndMs"]) for item in reference_shots),
        )
    )
    observation = observation or {
        "schema": MATCH_SCHEMA,
        "matches": [],
        "evidenceRefs": [],
    }
    if observation.get("schema") != MATCH_SCHEMA:
        raise ValueError(f"Observation must use {MATCH_SCHEMA}.")
    observation_refs = list(observation.get("evidenceRefs") or [])
    if observation_evidence_sha256:
        observation_refs.append(
            f"practice-match-observation:sha256:{observation_evidence_sha256}"
        )
    if not observation_refs:
        observation_refs.append("practice-match-observation:not-yet-generated")

    truth_ref = f"independent-truth:sha256:{truth_evidence_sha256}"
    reference_ref = f"reference-analysis:sha256:{reference_evidence_sha256}"
    return {
        "schema": RETAINED_SUITE_MANIFEST_SCHEMA,
        "editTypeId": str(edit_type_id).strip(),
        "mode": "MEASURE_ONLY",
        "cases": [{
            "finishPath": finish_path,
            "sourceMedia": source_media,
            "truth": {
                "caseId": str(case_id).strip(),
                "referenceId": str(reference["referenceId"]),
                "finishSha256": finish_sha256,
                "referenceDurationMs": duration_ms,
                "sourceMediaSha256": source_hashes,
                "truthAuthority": authority,
                "difficultyTags": tags,
                "shots": retained_shots,
                "evidenceRefs": [truth_ref, reference_ref],
            },
            "observation": {
                "caseId": str(case_id).strip(),
                "matches": list(observation.get("matches") or []),
                "evidenceRefs": observation_refs,
            },
        }],
    }



REVIEW_PACK_SCHEMA = "editflow.practice-truth-review-pack.v1"
DEFAULT_SOURCE_ATLAS_INTERVAL_MS = 120000.0
DEFAULT_SOURCE_ATLAS_MAX_FRAMES = 120
REVIEW_FIELDS = (
    "shotId",
    "referenceStartMs",
    "referenceEndMs",
    "previewEarly",
    "previewMiddle",
    "previewLate",
    "sourceId",
    "sourceStartMs",
    "sourceEndMs",
    "direction",
    "toleranceMs",
    "notes",
)


def require_pristine_truth_draft(draft, reference):
    if draft.get("schema") != TRUTH_SCHEMA or draft.get("status") != DRAFT_STATUS:
        raise ValueError("Review pack requires a DRAFT Practice truth scaffold.")
    if str(draft.get("referenceId")) != str(reference.get("referenceId")):
        raise ValueError("Truth draft referenceId does not match the Finish analysis.")
    if str(draft.get("referenceFingerprint", "")) != str(reference.get("styleFingerprint", "")):
        raise ValueError("Truth draft is stale for the current Finish style fingerprint.")
    if str(draft.get("referenceSourceSha256", "")).lower() != str(reference.get("sourceSha256", "")).lower():
        raise ValueError("Truth draft is stale for the current Finish media bytes.")
    if str(draft.get("referenceAnalyzerFingerprint", "")) != str(
        (reference.get("analysis") or {}).get("analyzerFingerprint", "")
    ):
        raise ValueError("Truth draft is stale for the current reference analyzer.")
    policy = draft.get("policy") or {}
    if policy.get("matcherSuggestionsAllowed") is not False or policy.get("matcherOutputMayBecomeTruth") is not False:
        raise ValueError("Truth draft does not preserve the no-matcher-leakage policy.")
    for row in draft.get("shots") or []:
        if any(row.get(key) is not None for key in (
            "sourceId",
            "sourceStartMs",
            "sourceEndMs",
            "direction",
            "toleranceMs",
        )):
            raise ValueError(
                "Review pack must be generated from a pristine scaffold with no source annotations."
            )


def _opencv_media_capture(video_path, cv2, purpose="review media"):
    video_path = Path(video_path).expanduser().resolve()
    capture = cv2.VideoCapture(str(video_path))
    if capture.isOpened():
        return capture
    capture.release()
    stat = video_path.stat()
    suffix = video_path.suffix.lower() if video_path.suffix and video_path.suffix.isascii() else ".mp4"
    identity = f"{video_path}|{stat.st_size}|{stat.st_mtime_ns}".encode("utf-8")
    alias_root = Path(tempfile.gettempdir()) / "editflow-practice-opencv"
    alias_root.mkdir(parents=True, exist_ok=True)
    alias_path = alias_root / (hashlib.sha256(identity).hexdigest()[:24] + suffix)
    if not alias_path.is_file() or alias_path.stat().st_size != stat.st_size:
        if alias_path.exists():
            alias_path.unlink()
        try:
            os.link(video_path, alias_path)
        except OSError:
            shutil.copy2(video_path, alias_path)
    capture = cv2.VideoCapture(str(alias_path))
    if capture.isOpened():
        return capture
    capture.release()
    raise RuntimeError(f"Could not open {purpose}: {video_path}")


def _opencv_preview_capture(video_path, cv2):
    return _opencv_media_capture(video_path, cv2, "Finish media for review preview")


def extract_preview_frame(video_path, time_ms, output_path):
    try:
        import cv2
    except ImportError as exc:
        raise RuntimeError(
            "OpenCV is required to render independent Finish review previews."
        ) from exc
    capture = _opencv_preview_capture(video_path, cv2)
    try:
        capture.set(cv2.CAP_PROP_POS_MSEC, max(0.0, float(time_ms)))
        ok, frame = capture.read()
        if not ok or frame is None:
            raise RuntimeError(
                f"Could not decode Finish review preview at {float(time_ms):.3f} ms."
            )
        target = Path(output_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        if not cv2.imwrite(str(target), frame):
            raise RuntimeError(f"Could not write Finish review preview: {target}")
    finally:
        capture.release()


def review_media_duration_ms(video_path):
    try:
        import cv2
    except ImportError as exc:
        raise RuntimeError(
            "OpenCV is required to inspect independent review media duration."
        ) from exc
    capture = _opencv_media_capture(video_path, cv2, "review media")
    try:
        fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
        frame_count = float(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0)
        if not math.isfinite(fps) or not math.isfinite(frame_count) or fps <= 0.0 or frame_count <= 0.0:
            raise RuntimeError(f"Could not determine review media duration: {video_path}")
        duration_ms = (frame_count / fps) * 1000.0
        if not math.isfinite(duration_ms) or duration_ms <= 0.0:
            raise RuntimeError(f"Could not determine review media duration: {video_path}")
        return duration_ms
    finally:
        capture.release()


def source_atlas_sample_times(duration_ms, interval_ms, max_frames):
    duration_ms = float(duration_ms)
    interval_ms = float(interval_ms)
    max_frames = int(max_frames)
    if not math.isfinite(duration_ms) or duration_ms <= 0.0:
        raise ValueError("Source-atlas duration must be positive and finite.")
    if not math.isfinite(interval_ms) or interval_ms <= 0.0:
        raise ValueError("Source-atlas interval must be positive and finite.")
    if max_frames < 1:
        raise ValueError("Source-atlas max frame count must be at least 1.")
    requested_count = max(1, int(math.ceil(duration_ms / interval_ms)))
    sample_count = min(max_frames, requested_count)
    step_ms = duration_ms / sample_count
    return [
        min(max(0.0, duration_ms - 1.0), step_ms * (index + 0.5))
        for index in range(sample_count)
    ]


def source_atlas_cache_key(source_sha256, duration_ms, interval_ms, max_frames):
    source_sha256 = str(source_sha256 or "").strip().lower()
    if not SHA256_PATTERN.fullmatch(source_sha256):
        raise ValueError("Source-atlas cache requires a valid source SHA-256.")
    payload = {
        "sourceSha256": source_sha256,
        "durationMs": round(float(duration_ms), 6),
        "intervalMs": round(float(interval_ms), 6),
        "maxFrames": int(max_frames),
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def _materialize_cached_preview(cache_path, output_path):
    cache_path = Path(cache_path)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.is_file():
        same_size = output_path.stat().st_size == cache_path.stat().st_size
        if same_size and sha256_file(output_path) == sha256_file(cache_path):
            return
        output_path.unlink()
    try:
        os.link(cache_path, output_path)
    except OSError:
        shutil.copy2(cache_path, output_path)


def build_source_atlas(
    source_id,
    source_path,
    output_dir,
    interval_ms,
    max_frames,
    preview_writer=None,
    duration_reader=None,
    cache_dir=None,
    source_sha256=None,
):
    duration_reader = duration_reader or review_media_duration_ms
    preview_writer = preview_writer or extract_preview_frame
    duration_ms = float(duration_reader(source_path))
    times_ms = source_atlas_sample_times(duration_ms, interval_ms, max_frames)
    safe_source = re.sub(r"[^A-Za-z0-9._-]+", "_", str(source_id))
    atlas_dir = Path(output_dir) / "source-atlas" / safe_source
    atlas_dir.mkdir(parents=True, exist_ok=True)
    cache_entry_dir = None
    cache_key = None
    cache_hit = False
    if cache_dir is not None:
        normalized_sha256 = str(source_sha256 or "").strip().lower()
        cache_key = source_atlas_cache_key(
            normalized_sha256,
            duration_ms,
            interval_ms,
            max_frames,
        )
        cache_entry_dir = (
            Path(cache_dir).expanduser().resolve()
            / normalized_sha256[:2]
            / cache_key
        )
        cache_entry_dir.mkdir(parents=True, exist_ok=True)
        expected_names = [
            f"{index:04d}-{int(round(time_ms)):010d}ms.png"
            for index, time_ms in enumerate(times_ms, start=1)
        ]
        cache_hit = all(
            (cache_entry_dir / name).is_file()
            and (cache_entry_dir / name).stat().st_size > 0
            for name in expected_names
        )

    samples = []
    for index, time_ms in enumerate(times_ms, start=1):
        name = f"{index:04d}-{int(round(time_ms)):010d}ms.png"
        output_path = atlas_dir / name
        if cache_entry_dir is None:
            preview_writer(source_path, time_ms, output_path)
        else:
            cache_path = cache_entry_dir / name
            if not cache_path.is_file() or cache_path.stat().st_size <= 0:
                if output_path.is_file() and output_path.stat().st_size > 0:
                    _materialize_cached_preview(output_path, cache_path)
                else:
                    preview_writer(source_path, time_ms, cache_path)
            _materialize_cached_preview(cache_path, output_path)
        samples.append({
            "timeMs": float(time_ms),
            "previewPath": str(Path("source-atlas") / safe_source / name),
        })
    return {
        "sourceId": str(source_id),
        "durationMs": duration_ms,
        "requestedIntervalMs": float(interval_ms),
        "maxFrames": int(max_frames),
        "sampleCount": len(samples),
        "samples": samples,
        **({} if cache_key is None else {
            "sourceSha256": str(source_sha256).strip().lower(),
            "cacheKey": cache_key,
            "cacheHit": cache_hit,
        }),
    }


def build_review_pack(
    reference,
    draft,
    finish_path,
    source_paths_by_id,
    output_dir,
    preview_writer=None,
    source_atlas_interval_ms=None,
    source_atlas_max_frames=DEFAULT_SOURCE_ATLAS_MAX_FRAMES,
    source_preview_writer=None,
    source_duration_reader=None,
    source_atlas_cache_dir=None,
):
    require_pristine_truth_draft(draft, reference)
    source_ids = sorted(
        {str(item).strip() for item in draft.get("allowedSourceIds") or [] if str(item).strip()}
    )
    expected_source_hashes = require_source_sha256_bindings(
        source_ids,
        draft.get("allowedSourceSha256"),
    )
    if set(source_paths_by_id) != set(source_ids):
        raise ValueError("Review-pack Start paths must cover the exact truth source-ID set.")

    finish_path = str(Path(finish_path).expanduser().resolve())
    finish_sha256 = sha256_file(finish_path)
    expected_finish_sha256 = str(reference.get("sourceSha256", "")).strip().lower()
    if finish_sha256 != expected_finish_sha256:
        raise ValueError("Review-pack Finish media bytes do not match the reference analysis.")

    normalized_sources = {}
    for source_id in source_ids:
        source_path = str(Path(source_paths_by_id[source_id]).expanduser().resolve())
        source_sha256 = sha256_file_cached(source_path)
        if source_sha256 != expected_source_hashes[source_id]:
            raise ValueError(
                f"Review-pack Start media bytes do not match the scaffold for source ID {source_id}."
            )
        normalized_sources[source_id] = {
            "path": source_path,
            "sha256": source_sha256,
        }

    target_dir = Path(output_dir).expanduser().resolve()
    preview_dir = target_dir / "finish-previews"
    target_dir.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)
    source_atlas_entries = []
    if source_atlas_interval_ms is not None:
        for source_id in source_ids:
            source_atlas_entries.append(build_source_atlas(
                source_id=source_id,
                source_path=normalized_sources[source_id]["path"],
                output_dir=target_dir,
                interval_ms=source_atlas_interval_ms,
                max_frames=source_atlas_max_frames,
                preview_writer=source_preview_writer,
                duration_reader=source_duration_reader,
                cache_dir=source_atlas_cache_dir,
                source_sha256=normalized_sources[source_id]["sha256"],
            ))
    writer = preview_writer or extract_preview_frame
    worksheet_rows = []
    preview_entries = []
    for shot in reference.get("shots") or []:
        shot_id = str(shot["shotId"])
        start = float(shot["referenceStartMs"])
        end = float(shot["referenceEndMs"])
        span = max(1.0, end - start)
        times = (
            start + (span * 0.15),
            start + (span * 0.50),
            start + (span * 0.85),
        )
        safe_id = re.sub(r"[^A-Za-z0-9._-]+", "_", shot_id)
        names = (
            f"{safe_id}-early.png",
            f"{safe_id}-middle.png",
            f"{safe_id}-late.png",
        )
        relative_paths = []
        for time_ms, name in zip(times, names):
            output_path = preview_dir / name
            writer(finish_path, time_ms, output_path)
            relative_paths.append(str(Path("finish-previews") / name))
        preview_entries.append({
            "shotId": shot_id,
            "referenceStartMs": start,
            "referenceEndMs": end,
            "previewTimesMs": [float(item) for item in times],
            "previewPaths": relative_paths,
        })
        worksheet_rows.append({
            "shotId": shot_id,
            "referenceStartMs": f"{start:.3f}",
            "referenceEndMs": f"{end:.3f}",
            "previewEarly": relative_paths[0],
            "previewMiddle": relative_paths[1],
            "previewLate": relative_paths[2],
            "sourceId": "",
            "sourceStartMs": "",
            "sourceEndMs": "",
            "direction": "",
            "toleranceMs": "",
            "notes": "",
        })

    worksheet_path = target_dir / "annotations.csv"
    with worksheet_path.open("w", encoding="utf-8", newline="") as handle:
        writer_csv = csv.DictWriter(handle, fieldnames=REVIEW_FIELDS)
        writer_csv.writeheader()
        writer_csv.writerows(worksheet_rows)

    manifest = {
        "schema": REVIEW_PACK_SCHEMA,
        "referenceId": str(reference["referenceId"]),
        "finish": {
            "path": finish_path,
            "sha256": finish_sha256,
        },
        "sources": [
            {
                "sourceId": source_id,
                **normalized_sources[source_id],
            }
            for source_id in source_ids
        ],
        "worksheet": str(worksheet_path),
        "previews": preview_entries,
        "sourceAtlas": source_atlas_entries,
        "policy": {
            "matcherSuggestionsAllowed": False,
            "matcherOutputMayBecomeTruth": False,
            "instruction": (
                "Annotate source identity, source interval, and playback direction independently. "
                "Do not inspect or copy EditFlow scene-match output while completing this worksheet."
            ),
        },
    }
    write_json(target_dir / "review-pack.json", manifest)
    instructions = (
        "EditFlow Practice independent truth review pack\n\n"
        "1. Review each Finish shot using the three still previews.\n"
        "2. If source-atlas/ exists, use its deterministic timecoded Start thumbnails only to locate coarse source windows.\n"
        "3. Inspect the declared Start media directly to refine exact source bounds; do not use EditFlow matcher predictions.\n"
        "4. Fill sourceId, sourceStartMs, sourceEndMs, and direction in annotations.csv.\n"
        "5. Keep sourceStartMs/sourceEndMs ascending even for REVERSE playback.\n"
        "6. Optionally set toleranceMs and notes.\n"
        "7. Run practice-media-truth.py import-review, then retain with the real independent annotation origin.\n"
    )
    (target_dir / "INSTRUCTIONS.txt").write_text(
        instructions,
        encoding="utf-8",
        newline="\n",
    )
    return manifest


def import_review_csv(draft, reference, worksheet_path):
    require_pristine_truth_draft(draft, reference)
    worksheet_path = Path(worksheet_path).expanduser().resolve()
    with worksheet_path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    reference_shots = list(reference.get("shots") or [])
    expected_ids = [str(item["shotId"]) for item in reference_shots]
    observed_ids = [str(item.get("shotId", "")).strip() for item in rows]
    if observed_ids != expected_ids:
        raise ValueError(
            "Review worksheet must cover every Finish shot exactly once in reference order."
        )

    allowed_sources = {
        str(item).strip()
        for item in draft.get("allowedSourceIds") or []
        if str(item).strip()
    }
    value = json.loads(json.dumps(draft))
    for output_row, input_row in zip(value["shots"], rows):
        source_id = str(input_row.get("sourceId", "")).strip()
        if source_id not in allowed_sources:
            raise ValueError(
                f"{output_row['shotId']}: sourceId must be one of the scaffolded Start source IDs."
            )
        try:
            source_start = float(str(input_row.get("sourceStartMs", "")).strip())
            source_end = float(str(input_row.get("sourceEndMs", "")).strip())
        except ValueError as exc:
            raise ValueError(
                f"{output_row['shotId']}: sourceStartMs/sourceEndMs must be numeric."
            ) from exc
        direction = str(input_row.get("direction", "")).strip().upper()
        if direction not in ALLOWED_DIRECTIONS:
            raise ValueError(
                f"{output_row['shotId']}: direction must be FORWARD or REVERSE."
            )
        tolerance_text = str(input_row.get("toleranceMs", "")).strip()
        try:
            tolerance = None if not tolerance_text else float(tolerance_text)
        except ValueError as exc:
            raise ValueError(
                f"{output_row['shotId']}: toleranceMs must be blank or numeric."
            ) from exc
        output_row.update({
            "sourceId": source_id,
            "sourceStartMs": source_start,
            "sourceEndMs": source_end,
            "direction": direction,
            "toleranceMs": tolerance,
            "notes": str(input_row.get("notes", "")),
        })

    structural_probe = json.loads(json.dumps(value))
    structural_probe["annotationOrigin"] = "INDEPENDENT_HUMAN"
    structural_probe["status"] = RETAINED_STATUS
    structural_probe["retainedAt"] = now_iso()
    errors = validate_truth(
        structural_probe,
        reference,
        allowed_source_ids=sorted(allowed_sources),
        allowed_source_sha256_by_id=draft.get("allowedSourceSha256"),
        require_retained=True,
    )
    if errors:
        raise ValueError(
            "Review worksheet cannot be imported:\n- " + "\n- ".join(errors)
        )
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

    review_parser = sub.add_parser("review-pack")
    review_parser.add_argument("--reference-analysis", required=True)
    review_parser.add_argument("--draft", required=True)
    review_parser.add_argument("--finish", required=True)
    review_parser.add_argument("--source", action="append", required=True)
    review_parser.add_argument("--output-dir", required=True)
    review_parser.add_argument(
        "--source-atlas-interval-ms",
        type=float,
        default=0.0,
        help="Generate matcher-blind Start thumbnails at this approximate interval; 0 disables.",
    )
    review_parser.add_argument(
        "--source-atlas-max-frames",
        type=int,
        default=DEFAULT_SOURCE_ATLAS_MAX_FRAMES,
    )
    review_parser.add_argument(
        "--source-atlas-cache-dir",
        help="Optional content-addressed cache for reusable Start thumbnails.",
    )

    import_review_parser = sub.add_parser("import-review")
    import_review_parser.add_argument("--reference-analysis", required=True)
    import_review_parser.add_argument("--draft", required=True)
    import_review_parser.add_argument("--worksheet", required=True)
    import_review_parser.add_argument("--output", required=True)

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

    suite_parser = sub.add_parser("suite-manifest")
    suite_parser.add_argument("--reference-analysis", required=True)
    suite_parser.add_argument("--truth", required=True)
    suite_parser.add_argument("--finish", required=True)
    suite_parser.add_argument("--source", action="append", required=True)
    suite_parser.add_argument("--case-id", required=True)
    suite_parser.add_argument("--edit-type-id", required=True)
    suite_parser.add_argument(
        "--difficulty",
        action="append",
        required=True,
        choices=sorted(ALLOWED_DIFFICULTIES),
    )
    suite_parser.add_argument("--matches")
    suite_parser.add_argument("--output", required=True)
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

    if args.command == "review-pack":
        draft = load_json(args.draft)
        source_paths_by_id = parse_source_path_args(args.source)
        payload = build_review_pack(
            reference=reference,
            draft=draft,
            finish_path=args.finish,
            source_paths_by_id=source_paths_by_id,
            output_dir=args.output_dir,
            source_atlas_interval_ms=(
                None if args.source_atlas_interval_ms == 0.0 else args.source_atlas_interval_ms
            ),
            source_atlas_max_frames=args.source_atlas_max_frames,
            source_atlas_cache_dir=args.source_atlas_cache_dir,
        )
        print(json.dumps({
            "ok": True,
            "schema": REVIEW_PACK_SCHEMA,
            "outputDir": str(Path(args.output_dir).resolve()),
            "worksheet": payload["worksheet"],
        }))
        return

    if args.command == "import-review":
        draft = load_json(args.draft)
        payload = import_review_csv(draft, reference, args.worksheet)
        write_json(args.output, payload)
        print(json.dumps({
            "ok": True,
            "status": DRAFT_STATUS,
            "output": str(Path(args.output).resolve()),
        }))
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

    if args.command == "suite-manifest":
        truth = load_json(args.truth)
        source_paths_by_id = parse_source_path_args(args.source)
        observation = load_json(args.matches) if args.matches else None
        payload = build_retained_suite_manifest(
            truth=truth,
            reference=reference,
            finish_path=args.finish,
            source_paths_by_id=source_paths_by_id,
            case_id=args.case_id,
            edit_type_id=args.edit_type_id,
            difficulty_tags=args.difficulty,
            truth_evidence_sha256=sha256_file(args.truth),
            reference_evidence_sha256=sha256_file(args.reference_analysis),
            observation=observation,
            observation_evidence_sha256=(
                sha256_file(args.matches) if args.matches else None
            ),
        )
        write_json(args.output, payload)
        print(json.dumps({
            "ok": True,
            "mode": "MEASURE_ONLY",
            "output": str(Path(args.output).resolve()),
        }))
        return

    raise RuntimeError("Unsupported command.")


if __name__ == "__main__":
    main()
