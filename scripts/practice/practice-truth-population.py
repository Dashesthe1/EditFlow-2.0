#!/usr/bin/env python3
import argparse
import copy
import csv
import hashlib
import importlib.util
import json
import math
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

POPULATION_SCHEMA = "editflow.practice-truth-population-plan.v1"
STATUS_SCHEMA = "editflow.practice-truth-population-status.v1"
WORK_QUEUE_SCHEMA = "editflow.practice-truth-population-work-queue.v1"
PROGRESSION_GATE_SCHEMA = "editflow.practice-truth-population-progression-gate.v1"
ACQUISITION_PLAN_SCHEMA = "editflow.practice-truth-acquisition-plan.v1"
ACQUISITION_BINDABILITY_SCHEMA = "editflow.practice-truth-acquisition-bindability.v1"
ACQUISITION_RUN_SCHEMA = "editflow.practice-truth-acquisition-run.v1"
REFERENCE_SCHEMA = "editflow.practice-reference-analysis.v1"
TRUTH_SCHEMA = "editflow.practice-media-benchmark-truth.v1"
MATCH_SCHEMA = "editflow.practice-scene-matches.v1"
REVIEW_PACK_SCHEMA = "editflow.practice-truth-review-pack.v1"
REVIEW_ATTESTATION_SCHEMA = "editflow.practice-truth-review-attestation.v1"
RETAINED_SUITE_SCHEMA = "editflow.practice-retained-truth-suite-manifest.v1"
SOURCE_BINDING_SCHEMA = "editflow.practice-source-binding.v1"
REQUIRED_REVIEW_FIELDS = ("sourceId", "sourceStartMs", "sourceEndMs", "direction")
ALLOWED_DIRECTIONS = {"FORWARD", "REVERSE"}
ALLOWED_ANNOTATION_ORIGINS = {"INDEPENDENT_HUMAN", "INDEPENDENT_EXTERNAL_TOOL"}
ALLOWED_DIFFICULTIES = {
    "FAST_CUTS", "NEAR_DUPLICATE_SOURCES", "REVERSE_OR_REWIND", "LOW_INFORMATION",
    "STRONG_CAMERA_MOTION", "OCCLUSION", "IDENTITY_AMBIGUITY",
    "HEAVY_EFFECT_OBSCURATION", "REPEATED_SCENERY",
}
MIN_CASES = 20
MAX_CASES = 30
MIN_DIFFICULTY_KINDS = 4
MIN_DISTINCT_SOURCE_SETS = 3
PERCEPTUAL_DUPLICATE_SIMILARITY = 0.96
PREPARE_SCHEMA = "editflow.practice-truth-review-preparation.v1"
FINALIZE_SCHEMA = "editflow.practice-truth-review-finalization.v1"
ADVANCE_SCHEMA = "editflow.practice-truth-population-advance.v1"
MATCHER_OBSERVATION_SCHEMA = "editflow.practice-truth-matcher-observation.v1"
SUITE_BUILD_SCHEMA = "editflow.practice-truth-suite-build.v1"
DISCOVERY_SCHEMA = "editflow.practice-truth-finish-discovery.v1"
VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".m4v", ".webm"}
DEFAULT_SOURCE_ATLAS_INTERVAL_MS = 300000.0
DEFAULT_SOURCE_ATLAS_MAX_FRAMES = 30
DEFAULT_MATCHER_SAMPLE_STEP_MS = 500.0
DEFAULT_MATCHER_ANALYSIS_FPS = 6.0
DEFAULT_MATCHER_COARSE_LIMIT = 16


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def perceptual_signature_parts(value):
    parts = [part.strip().lower() for part in str(value or "").split(",") if part.strip()]
    if len(parts) < 8:
        return []
    try:
        if any(len(part) != 16 for part in parts):
            return []
        for part in parts:
            int(part, 16)
    except ValueError:
        return []
    return parts


def perceptual_similarity(left, right):
    left_parts = perceptual_signature_parts(left)
    right_parts = perceptual_signature_parts(right)
    if not left_parts or len(left_parts) != len(right_parts):
        return None
    similarity = 0.0
    for left_part, right_part in zip(left_parts, right_parts):
        distance = (int(left_part, 16) ^ int(right_part, 16)).bit_count()
        similarity += 1.0 - distance / 64.0
    return similarity / len(left_parts)


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def write_json(path, payload):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8", newline="\n")


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def resolve_path(manifest_path, value):
    if not value:
        return None
    path = Path(str(value)).expanduser()
    if not path.is_absolute():
        path = Path(manifest_path).resolve().parent / path
    return path.resolve()


def load_corpus_tool():
    script = Path(__file__).with_name("practice-retained-corpus.py")
    spec = importlib.util.spec_from_file_location("practice_retained_corpus", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_media_truth_tool():
    script = Path(__file__).with_name("practice-media-truth.py")
    spec = importlib.util.spec_from_file_location("practice_media_truth", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_media_match_tool():
    script = Path(__file__).with_name("practice-media-match.py")
    spec = importlib.util.spec_from_file_location("practice_media_match", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_source_binding_tool():
    script = Path(__file__).with_name("practice-source-binding.py")
    spec = importlib.util.spec_from_file_location("practice_source_binding", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def finish_perceptual_signature(path, signature_provider=None):
    if signature_provider is not None:
        return signature_provider(Path(path))
    media_match = load_media_match_tool()
    reader = media_match.FrameReader(path)
    try:
        return media_match.perceptual_signature_from_reader(reader, reader.duration_ms)
    finally:
        reader.close()


def require_plan(path):
    payload = load_json(path)
    if payload.get("schema") != POPULATION_SCHEMA:
        raise ValueError(f"{path}: unsupported Practice truth population schema.")
    if not str(payload.get("editTypeId", "")).strip():
        raise ValueError(f"{path}: population plan is missing editTypeId.")

    cases = payload.get("cases")
    if not isinstance(cases, list) or not cases:
        raise ValueError(f"{path}: population plan contains no cases.")
    return payload


def source_ids(case):
    values = []
    for item in case.get("sourceMedia") or []:
        if isinstance(item, dict) and str(item.get("sourceId", "")).strip():
            values.append(str(item["sourceId"]).strip())
    return sorted(set(values))


def safe_stem(value):
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", str(value).strip()).strip("-._")
    return stem or "case"


def parse_source_video_specs(values):
    result = {}
    for value in values or []:
        source_id, separator, media_path = str(value).partition("=")
        source_id = source_id.strip()
        media_path = media_path.strip()
        if not separator or not source_id or not media_path:
            raise ValueError("Source video must use sourceId=path syntax.")
        if source_id in result:
            raise ValueError("Duplicate Start source id: " + source_id)
        path = Path(media_path).expanduser().resolve()
        if not path.is_file():
            raise ValueError("Start source media does not exist: " + str(path))
        result[source_id] = path
    if not result:
        raise ValueError("At least one Start source video is required.")
    return result


def parse_acquisition_difficulty_specs(values):
    result = {}
    for value in values or []:
        case_id, separator, raw_tags = str(value).partition("=")
        case_id = case_id.strip()
        tags = [item.strip() for item in raw_tags.split(",") if item.strip()]
        if not separator or not case_id or not tags:
            raise ValueError("Acquisition difficulty must use caseId=TAG[,TAG] syntax.")
        invalid = [tag for tag in tags if tag not in ALLOWED_DIFFICULTIES]
        if invalid:
            raise ValueError("Invalid Practice difficulty tag(s): " + ", ".join(sorted(set(invalid))))
        retained = result.setdefault(case_id, [])
        for tag in tags:
            if tag not in retained:
                retained.append(tag)
    return result


def worksheet_validation_reasons(path, draft, reference):
    if not path or not Path(path).is_file():
        return ["Review worksheet is missing."]

    with Path(path).open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    expected_ids = [str(item.get("shotId", "")).strip() for item in reference.get("shots") or []]
    observed_ids = [str(item.get("shotId", "")).strip() for item in rows]
    if observed_ids != expected_ids:
        return ["Review worksheet must cover every Finish shot exactly once in reference order."]

    allowed_sources = {
        str(item).strip()
        for item in draft.get("allowedSourceIds") or []
        if str(item).strip()
    }
    reasons = []
    for row in rows:
        shot_id = str(row.get("shotId", "")).strip() or "<missing-shot-id>"
        if any(not str(row.get(field, "")).strip() for field in REQUIRED_REVIEW_FIELDS):
            reasons.append(f"{shot_id}: independent review fields are incomplete.")
            continue
        source_id = str(row.get("sourceId", "")).strip()
        if source_id not in allowed_sources:
            reasons.append(f"{shot_id}: sourceId must be one of the scaffolded Start source IDs.")
        direction = str(row.get("direction", "")).strip().upper()
        if direction not in ALLOWED_DIRECTIONS:
            reasons.append(f"{shot_id}: direction must be FORWARD or REVERSE.")
        try:
            source_start = float(str(row.get("sourceStartMs", "")).strip())
            source_end = float(str(row.get("sourceEndMs", "")).strip())
        except ValueError:
            reasons.append(f"{shot_id}: sourceStartMs/sourceEndMs must be numeric.")
            continue
        if not math.isfinite(source_start) or not math.isfinite(source_end):
            reasons.append(f"{shot_id}: sourceStartMs/sourceEndMs must be finite.")
        elif source_start < 0.0 or source_end <= source_start:
            reasons.append(f"{shot_id}: source interval must be non-negative and ascending.")
    return reasons


def worksheet_complete(path, draft=None, reference=None):
    if draft is not None and reference is not None:
        return not worksheet_validation_reasons(path, draft, reference)
    if not path or not Path(path).is_file():
        return False
    with Path(path).open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    if not rows:
        return False
    for row in rows:
        if any(not str(row.get(field, "")).strip() for field in REQUIRED_REVIEW_FIELDS):
            return False
        if str(row.get("direction", "")).strip().upper() not in ALLOWED_DIRECTIONS:
            return False
        try:
            source_start = float(str(row["sourceStartMs"]).strip())
            source_end = float(str(row["sourceEndMs"]).strip())
        except ValueError:
            return False
        if source_start < 0.0 or source_end <= source_start:
            return False
    return True


def review_pack_has_source_atlas(review_dir, expected_source_ids, expected_source_sha256=None):
    review_dir = Path(review_dir)
    manifest_path = review_dir / "review-pack.json"
    if not manifest_path.is_file():
        return False
    try:
        pack = load_json(manifest_path)
    except (OSError, ValueError, json.JSONDecodeError):
        return False
    if pack.get("schema") != REVIEW_PACK_SCHEMA:
        return False
    atlas = pack.get("sourceAtlas")
    if not isinstance(atlas, list):
        return False
    by_source = {
        str(item.get("sourceId", "")).strip(): item
        for item in atlas
        if isinstance(item, dict) and str(item.get("sourceId", "")).strip()
    }
    if sorted(by_source) != sorted(expected_source_ids):
        return False
    expected_hashes = {
        str(source_id).strip(): str(source_sha256).strip().lower()
        for source_id, source_sha256 in (expected_source_sha256 or {}).items()
    }
    if expected_hashes and set(expected_hashes) != set(expected_source_ids):
        return False
    for source_id in expected_source_ids:
        atlas_source_sha256 = str(
            by_source[source_id].get("sourceSha256", "")
        ).strip().lower()
        if expected_hashes and atlas_source_sha256 != expected_hashes[source_id]:
            return False
        samples = by_source[source_id].get("samples")
        if not isinstance(samples, list) or not samples:
            return False
        for sample in samples:
            preview = sample.get("previewPath") if isinstance(sample, dict) else None
            if not preview or not (review_dir / str(preview)).is_file():
                return False
    return True


def review_pack_preparation_complete(
    review_dir,
    expected_source_ids,
    expected_source_sha256=None,
    expected_finish_sha256=None,
    require_source_atlas=True,
):
    review_dir = Path(review_dir)
    manifest_path = review_dir / "review-pack.json"
    worksheet_path = review_dir / "annotations.csv"
    if not manifest_path.is_file() or not worksheet_path.is_file():
        return False
    try:
        pack = load_json(manifest_path)
    except (OSError, ValueError, json.JSONDecodeError):
        return False
    if pack.get("schema") != REVIEW_PACK_SCHEMA:
        return False
    policy = pack.get("policy")
    if (
        not isinstance(policy, dict)
        or policy.get("matcherSuggestionsAllowed") is not False
        or policy.get("matcherOutputMayBecomeTruth") is not False
    ):
        return False
    expected_hashes = {
        str(source_id).strip(): str(source_sha256).strip().lower()
        for source_id, source_sha256 in (expected_source_sha256 or {}).items()
    }
    if expected_hashes:
        sources = pack.get("sources")
        if not isinstance(sources, list):
            return False
        by_source = {
            str(item.get("sourceId", "")).strip(): item
            for item in sources
            if isinstance(item, dict) and str(item.get("sourceId", "")).strip()
        }
        if (
            set(by_source) != set(expected_source_ids)
            or set(expected_hashes) != set(expected_source_ids)
        ):
            return False
        for source_id in expected_source_ids:
            pack_source_sha256 = str(
                by_source[source_id].get("sha256", "")
            ).strip().lower()
            if pack_source_sha256 != expected_hashes[source_id]:
                return False
    if expected_finish_sha256:
        finish = pack.get("finish")
        if not isinstance(finish, dict):
            return False
        pack_finish_sha256 = str(finish.get("sha256", "")).strip().lower()
        if pack_finish_sha256 != str(expected_finish_sha256).strip().lower():
            return False
    previews = pack.get("previews")
    if not isinstance(previews, list) or not previews:
        return False
    for item in previews:
        preview_paths = item.get("previewPaths") if isinstance(item, dict) else None
        if not isinstance(preview_paths, list) or not preview_paths:
            return False
        if any(not (review_dir / str(path)).is_file() for path in preview_paths):
            return False
    if require_source_atlas and not review_pack_has_source_atlas(
        review_dir,
        expected_source_ids,
        expected_source_sha256=expected_hashes,
    ):
        return False
    return True


def review_pack_matcher_blind_reasons(review_dir):
    review_dir = Path(review_dir)
    manifest_path = review_dir / "review-pack.json"
    if not manifest_path.is_file():
        return ["Review-pack manifest is missing."]
    try:
        pack = load_json(manifest_path)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        return ["Review-pack manifest cannot be read: " + str(exc)]
    if pack.get("schema") != REVIEW_PACK_SCHEMA:
        return ["Review-pack schema is invalid."]
    policy = pack.get("policy")
    if not isinstance(policy, dict):
        return ["Review-pack matcher-blind policy is missing."]
    reasons = []
    if policy.get("matcherSuggestionsAllowed") is not False:
        reasons.append("Review pack must explicitly forbid matcher suggestions.")
    if policy.get("matcherOutputMayBecomeTruth") is not False:
        reasons.append("Review pack must explicitly forbid matcher output from becoming truth.")
    return reasons


def review_attestation_validation_reasons(
    review_dir,
    retained_truth_path=None,
    expected_annotation_origin=None,
    expected_case_id=None,
    expected_finish_sha256=None,
    expected_source_sha256_by_id=None,
):
    review_dir = Path(review_dir)
    attestation_path = review_dir / "review-attestation.json"
    review_pack_path = review_dir / "review-pack.json"
    worksheet_path = review_dir / "annotations.csv"
    if not attestation_path.is_file():
        return ["Independent review attestation is missing."]
    try:
        attestation = load_json(attestation_path)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        return ["Independent review attestation cannot be read: " + str(exc)]
    reasons = list(review_pack_matcher_blind_reasons(review_dir))
    if attestation.get("schema") != REVIEW_ATTESTATION_SCHEMA:
        reasons.append("Independent review attestation schema is invalid.")
    if expected_case_id and str(attestation.get("caseId", "")).strip() != str(expected_case_id).strip():
        reasons.append("Independent review attestation case id does not match the population case.")
    if expected_finish_sha256:
        observed_finish_sha = str(attestation.get("finishSha256", "")).strip().lower()
        if observed_finish_sha != str(expected_finish_sha256).strip().lower():
            reasons.append("Independent review attestation does not match the current Finish media bytes.")
    if expected_source_sha256_by_id is not None:
        observed_source_hashes = {
            str(source_id).strip(): str(source_sha).strip().lower()
            for source_id, source_sha in (attestation.get("sourceSha256ById") or {}).items()
        }
        expected_source_hashes = {
            str(source_id).strip(): str(source_sha).strip().lower()
            for source_id, source_sha in expected_source_sha256_by_id.items()
        }
        if observed_source_hashes != expected_source_hashes:
            reasons.append("Independent review attestation does not match the current Start media bytes.")
    origin = str(attestation.get("annotationOrigin", "")).strip()
    if origin not in ALLOWED_ANNOTATION_ORIGINS:
        reasons.append("Independent review attestation has an invalid annotation origin.")
    if expected_annotation_origin and origin != str(expected_annotation_origin).strip():
        reasons.append("Independent review attestation origin does not match retained truth.")
    if attestation.get("matcherBlindWorkflowVerified") is not True:
        reasons.append("Independent review attestation does not verify the matcher-blind workflow.")
    for path, field, label in (
        (review_pack_path, "reviewPackSha256", "review pack"),
        (worksheet_path, "worksheetSha256", "review worksheet"),
    ):
        if not path.is_file():
            reasons.append(label.capitalize() + " is missing.")
            continue
        if str(attestation.get(field, "")).strip().lower() != sha256_file(path):
            reasons.append("Independent review attestation no longer matches the " + label + ".")
    if retained_truth_path is not None:
        retained_truth_path = Path(retained_truth_path)
        if not retained_truth_path.is_file():
            reasons.append("Retained truth file is missing.")
        elif str(attestation.get("retainedTruthSha256", "")).strip().lower() != sha256_file(
            retained_truth_path
        ):
            reasons.append("Independent review attestation no longer matches retained truth.")
    return reasons


def artifact_path(case, manifest_path, key):
    return resolve_path(manifest_path, case.get(key))


def inspect_case(case, manifest_path, corpus):
    case_id = str(case.get("caseId", "")).strip()
    tags = [str(item).strip() for item in case.get("difficultyTags") or [] if str(item).strip()]
    reasons = []
    if not case_id:
        reasons.append("Case id is empty.")
    if not tags or any(tag not in ALLOWED_DIFFICULTIES for tag in tags):
        reasons.append("Difficulty tags are missing or invalid.")

    finish = artifact_path(case, manifest_path, "finishPath")
    sources = case.get("sourceMedia")
    if finish is None or not finish.is_file():
        reasons.append("Finish media is missing.")
    if not isinstance(sources, list) or not sources:
        reasons.append("Start source media is missing.")
    else:
        for item in sources:
            path = resolve_path(manifest_path, item.get("path") if isinstance(item, dict) else None)
            if path is None or not path.is_file():
                reasons.append("At least one Start source media file is missing.")
                break
    if reasons:
        return case_result(case_id, tags, "MEDIA_INTAKE", "FIX_MEDIA_INTAKE", reasons)

    reference_path = artifact_path(case, manifest_path, "referenceAnalysis")
    if reference_path is None or not reference_path.is_file():
        return case_result(case_id, tags, "REFERENCE_ANALYSIS", "ANALYZE_REFERENCE")
    reference = load_json(reference_path)
    if reference.get("schema") != REFERENCE_SCHEMA:
        return case_result(case_id, tags, "REFERENCE_ANALYSIS", "REBUILD_REFERENCE_ANALYSIS",
                           ["Reference analysis schema is invalid."])

    retained_path = artifact_path(case, manifest_path, "retainedTruth")
    if retained_path is None or not retained_path.is_file():
        draft_path = artifact_path(case, manifest_path, "truthDraft")
        if draft_path is None or not draft_path.is_file():
            return case_result(case_id, tags, "TRUTH_SCAFFOLD", "SCAFFOLD_TRUTH")
        draft = load_json(draft_path)
        if draft.get("schema") != TRUTH_SCHEMA or draft.get("status") != "DRAFT":
            return case_result(case_id, tags, "TRUTH_SCAFFOLD", "REBUILD_TRUTH_SCAFFOLD",
                               ["Truth draft is not a valid DRAFT artifact."])
        if str(draft.get("referenceId", "")) != str(reference.get("referenceId", "")):
            return case_result(case_id, tags, "TRUTH_SCAFFOLD", "REBUILD_TRUTH_SCAFFOLD",
                               ["Truth draft reference does not match Finish analysis."])
        if sorted(draft.get("allowedSourceIds") or []) != source_ids(case):
            return case_result(case_id, tags, "TRUTH_SCAFFOLD", "REBUILD_TRUTH_SCAFFOLD",
                               ["Truth draft source set does not match intake source IDs."])

        review_dir = artifact_path(case, manifest_path, "reviewPackDir")
        review_manifest = None if review_dir is None else review_dir / "review-pack.json"
        worksheet = None if review_dir is None else review_dir / "annotations.csv"
        if review_manifest is None or not review_manifest.is_file() or not worksheet.is_file():
            return case_result(case_id, tags, "REVIEW_PACK", "CREATE_REVIEW_PACK")
        pack = load_json(review_manifest)
        if pack.get("schema") != REVIEW_PACK_SCHEMA:
            return case_result(case_id, tags, "REVIEW_PACK", "REBUILD_REVIEW_PACK",
                               ["Review-pack schema is invalid."])
        policy_reasons = review_pack_matcher_blind_reasons(review_dir)
        if policy_reasons:
            return case_result(
                case_id,
                tags,
                "REVIEW_PACK",
                "REBUILD_REVIEW_PACK",
                policy_reasons,
            )
        review_reasons = worksheet_validation_reasons(
            worksheet,
            draft,
            reference,
        )
        if review_reasons:
            return case_result(
                case_id,
                tags,
                "INDEPENDENT_REVIEW",
                "COMPLETE_INDEPENDENT_REVIEW",
                review_reasons,
            )
        return case_result(case_id, tags, "TRUTH_RETENTION", "FINALIZE_INDEPENDENT_REVIEW")

    retained = load_json(retained_path)
    if retained.get("schema") != TRUTH_SCHEMA or retained.get("status") != "RETAINED":
        return case_result(case_id, tags, "TRUTH_RETENTION", "RETAIN_TRUTH",
                           ["Retained truth artifact is invalid or not retained."])
    if retained.get("annotationOrigin") not in ALLOWED_ANNOTATION_ORIGINS:
        return case_result(case_id, tags, "TRUTH_RETENTION", "RETAIN_TRUTH",
                           ["Retained truth does not have an independent annotation origin."])
    expected_finish_sha = str(retained.get("referenceSourceSha256", "")).strip().lower()
    if expected_finish_sha != sha256_file(finish):
        return case_result(
            case_id,
            tags,
            "TRUTH_RETENTION",
            "FINALIZE_INDEPENDENT_REVIEW",
            ["Finish media bytes changed after independent truth retention."],
        )
    try:
        current_source_paths = _case_source_paths(case, manifest_path)
    except ValueError as exc:
        return case_result(case_id, tags, "MEDIA_INTAKE", "FIX_MEDIA_INTAKE", [str(exc)])
    retained_source_hashes = {
        str(source_id).strip(): str(source_sha).strip().lower()
        for source_id, source_sha in (retained.get("allowedSourceSha256") or {}).items()
    }
    current_source_hashes = {
        source_id: sha256_file(source_path)
        for source_id, source_path in current_source_paths.items()
    }
    if retained_source_hashes != current_source_hashes:
        return case_result(
            case_id,
            tags,
            "TRUTH_RETENTION",
            "FINALIZE_INDEPENDENT_REVIEW",
            ["Start media bytes changed after independent truth retention."],
        )
    review_dir = artifact_path(case, manifest_path, "reviewPackDir")
    if review_dir is None:
        return case_result(
            case_id,
            tags,
            "INDEPENDENT_REVIEW_ATTESTATION",
            "FINALIZE_INDEPENDENT_REVIEW",
            ["Review-pack directory is missing from the population case."],
        )
    attestation_reasons = review_attestation_validation_reasons(
        review_dir,
        retained_truth_path=retained_path,
        expected_annotation_origin=retained.get("annotationOrigin"),
        expected_case_id=case_id,
        expected_finish_sha256=expected_finish_sha,
        expected_source_sha256_by_id=current_source_hashes,
    )
    if attestation_reasons:
        return case_result(
            case_id,
            tags,
            "INDEPENDENT_REVIEW_ATTESTATION",
            "FINALIZE_INDEPENDENT_REVIEW",
            attestation_reasons,
        )

    matches_path = artifact_path(case, manifest_path, "matches")
    if matches_path is None or not matches_path.is_file():
        return case_result(case_id, tags, "MATCHER_OBSERVATION", "RUN_MATCHER_OBSERVATION")

    matches = load_json(matches_path)
    if matches.get("schema") != MATCH_SCHEMA:
        return case_result(case_id, tags, "MATCHER_OBSERVATION", "RERUN_MATCHER_OBSERVATION",
                           ["Matcher observation schema is invalid."])

    suite_path = artifact_path(case, manifest_path, "suiteManifest")
    if suite_path is None or not suite_path.is_file():
        return case_result(case_id, tags, "SUITE_MANIFEST", "BUILD_SUITE_MANIFEST")
    try:
        suite = corpus.require_manifest(suite_path)
        if len(suite["cases"]) != 1:
            raise ValueError("Population suite manifest must contain exactly one case.")
        normalized = corpus.normalize_case(suite["cases"][0], suite_path)
        per_case_reasons = corpus.case_preflight_reasons(normalized)
    except Exception as exc:
        return case_result(case_id, tags, "SUITE_MANIFEST", "REBUILD_SUITE_MANIFEST", [str(exc)])
    if per_case_reasons:
        return case_result(case_id, tags, "SUITE_MANIFEST", "REBUILD_SUITE_MANIFEST", per_case_reasons)
    return case_result(case_id, tags, "READY_FOR_CORPUS", "NONE")


def case_result(case_id, tags, stage, next_action, reasons=None):
    return {
        "caseId": case_id,
        "difficultyTags": tags,
        "stage": stage,
        "nextAction": next_action,
        "readyForCorpus": stage == "READY_FOR_CORPUS",
        "reasons": list(reasons or []),
    }


def population_finish_identity_reasons(plan, plan_path):
    identities = []
    for case in plan["cases"]:
        case_id = str(case.get("caseId", "")).strip() or "<missing-case-id>"
        finish = artifact_path(case, plan_path, "finishPath")
        if finish is None or not finish.is_file():
            continue
        finish_sha = sha256_file(finish)
        signature = None
        reference_path = artifact_path(case, plan_path, "referenceAnalysis")
        if reference_path is not None and reference_path.is_file():
            try:
                reference = load_json(reference_path)
                if reference.get("schema") == REFERENCE_SCHEMA:
                    signature = reference.get("perceptualSignature")
            except (OSError, ValueError, json.JSONDecodeError):
                signature = None
        identities.append((case_id, finish_sha, signature))

    exact_seen = {}
    exact_pairs = []
    for case_id, finish_sha, _signature in identities:
        previous = exact_seen.get(finish_sha)
        if previous is not None:
            exact_pairs.append((previous, case_id))
        else:
            exact_seen[finish_sha] = case_id

    perceptual_pairs = []
    for index, (left_id, left_sha, left_signature) in enumerate(identities):
        for right_id, right_sha, right_signature in identities[index + 1:]:
            if left_sha == right_sha:
                continue
            similarity = perceptual_similarity(left_signature, right_signature)
            if similarity is not None and similarity >= PERCEPTUAL_DUPLICATE_SIMILARITY:
                perceptual_pairs.append((left_id, right_id, similarity))

    reasons = []
    if exact_pairs:
        examples = ", ".join(f"{left}/{right}" for left, right in exact_pairs[:3])
        reasons.append("Population reuses exact Finish media bytes across distinct cases: " + examples + ".")
    if perceptual_pairs:
        examples = ", ".join(
            f"{left}/{right}={similarity:.4f}"
            for left, right, similarity in perceptual_pairs[:3]
        )
        reasons.append(
            "Population reuses perceptually equivalent Finish material at or above "
            f"{PERCEPTUAL_DUPLICATE_SIMILARITY:.2f} similarity: {examples}."
        )
    return reasons


def population_coverage(plan, results, difficulty_counts):
    source_set_counts = Counter()
    for case in plan["cases"]:
        ids = source_ids(case)
        if ids:
            source_set_counts["|".join(ids)] += 1
    represented = sorted(difficulty_counts)
    return {
        "targetCaseWindow": {"min": MIN_CASES, "max": MAX_CASES},
        "casesNeededForMinimum": max(0, MIN_CASES - len(results)),
        "targetDifficultyKinds": MIN_DIFFICULTY_KINDS,
        "representedDifficultyKinds": represented,
        "difficultyKindsNeeded": max(0, MIN_DIFFICULTY_KINDS - len(represented)),
        "unrepresentedDifficultyKinds": sorted(ALLOWED_DIFFICULTIES - set(represented)),
        "targetDistinctSourceSets": MIN_DISTINCT_SOURCE_SETS,
        "distinctSourceSetCount": len(source_set_counts),
        "sourceSetsNeeded": max(0, MIN_DISTINCT_SOURCE_SETS - len(source_set_counts)),
        "sourceSetCounts": dict(sorted(source_set_counts.items())),
    }


def population_projection(plan):
    difficulty_counts = Counter(
        tag
        for case in plan.get("cases") or []
        for tag in case.get("difficultyTags") or []
        if tag in ALLOWED_DIFFICULTIES
    )
    return population_coverage(
        plan,
        list(plan.get("cases") or []),
        difficulty_counts,
    )


def candidate_finish_duplicate_reasons(
    plan,
    plan_path,
    finish_path,
    candidate_signature=None,
    signature_provider=None,
):
    finish_path = Path(finish_path).resolve()
    finish_sha = sha256_file(finish_path)
    if not perceptual_signature_parts(candidate_signature):
        candidate_signature = finish_perceptual_signature(
            finish_path,
            signature_provider=signature_provider,
        )
    if not perceptual_signature_parts(candidate_signature):
        raise ValueError("Candidate Finish perceptual signature is unavailable or invalid.")

    reasons = []
    for case in plan["cases"]:
        case_id = str(case.get("caseId", "")).strip() or "<missing-case-id>"
        planned_finish = artifact_path(case, plan_path, "finishPath")
        if planned_finish is None or not planned_finish.is_file():
            continue
        planned_sha = sha256_file(planned_finish)
        if planned_sha == finish_sha:
            reasons.append("Finish media exactly duplicates planned case " + case_id + ".")
            continue
        planned_signature = None
        reference_path = artifact_path(case, plan_path, "referenceAnalysis")
        if reference_path is not None and reference_path.is_file():
            try:
                reference = load_json(reference_path)
                if reference.get("schema") == REFERENCE_SCHEMA:
                    planned_signature = reference.get("perceptualSignature")
            except (OSError, ValueError, json.JSONDecodeError):
                planned_signature = None
        if not perceptual_signature_parts(planned_signature):
            planned_signature = finish_perceptual_signature(
                planned_finish,
                signature_provider=signature_provider,
            )
        similarity = perceptual_similarity(candidate_signature, planned_signature)
        if similarity is not None and similarity >= PERCEPTUAL_DUPLICATE_SIMILARITY:
            reasons.append(
                "Finish media is perceptually equivalent to planned case "
                + case_id
                + f" ({similarity:.4f})."
            )
    return reasons


def validate_bound_sources(binding, source_paths):
    if binding.get("schema") != SOURCE_BINDING_SCHEMA:
        raise ValueError("Source binding schema is invalid.")
    if binding.get("status") != "BOUND":
        raise ValueError("Source binding must have BOUND status before admission.")

    bound = {}
    for item in binding.get("sourceBindings") or []:
        source_id = str(item.get("sourceId", "")).strip() if isinstance(item, dict) else ""
        source_sha = str(item.get("sourceSha256", "")).strip().lower() if isinstance(item, dict) else ""
        if (
            not source_id
            or len(source_sha) != 64
            or any(character not in "0123456789abcdef" for character in source_sha)
        ):
            raise ValueError("Source binding contains an invalid source identity.")
        if source_id in bound and bound[source_id] != source_sha:
            raise ValueError("Source binding maps one source id to multiple content identities.")
        bound[source_id] = source_sha
    if not bound:
        raise ValueError("Source binding contains no retained Start source identity.")

    missing = sorted(set(bound) - set(source_paths))
    if missing:
        raise ValueError("Missing raw Start source for bound id(s): " + ", ".join(missing))
    for source_id, expected_sha in bound.items():
        actual_sha = sha256_file(source_paths[source_id])
        if actual_sha.lower() != expected_sha:
            raise ValueError("Start source content identity changed for " + source_id + ".")
    return bound


def admit_bound_case(
    plan_path,
    case_id,
    finish_path,
    binding_path,
    source_video_specs,
    difficulty_tags,
    case_dir=None,
    signature_provider=None,
):
    plan = require_plan(plan_path)
    case_id = str(case_id).strip()
    if not case_id:
        raise ValueError("Population case id is required.")
    if any(str(item.get("caseId", "")).strip() == case_id for item in plan["cases"]):
        raise ValueError("Population case id already exists: " + case_id)
    if len(plan["cases"]) >= MAX_CASES:
        raise ValueError(f"Population already contains the maximum {MAX_CASES} cases.")

    tags = list(dict.fromkeys(
        str(tag).strip()
        for tag in difficulty_tags or []
        if str(tag).strip()
    ))
    if not tags or any(tag not in ALLOWED_DIFFICULTIES for tag in tags):
        raise ValueError("Difficulty tags are missing or invalid.")

    finish_path = Path(finish_path).expanduser().resolve()
    if not finish_path.is_file():
        raise ValueError("Finish media does not exist: " + str(finish_path))
    binding_path = Path(binding_path).expanduser().resolve()
    if not binding_path.is_file():
        raise ValueError("Source binding does not exist: " + str(binding_path))
    binding = load_json(binding_path)

    source_paths = parse_source_video_specs(source_video_specs)
    bound = validate_bound_sources(binding, source_paths)

    reference_path = Path(str(binding.get("referencePath", ""))).expanduser().resolve()
    if not reference_path.is_file():
        raise ValueError("Bound reference analysis does not exist: " + str(reference_path))
    reference = load_json(reference_path)
    if reference.get("schema") != REFERENCE_SCHEMA:
        raise ValueError("Bound reference analysis schema is invalid.")
    if str(binding.get("referenceId", "")).strip() != str(reference.get("referenceId", "")).strip():
        raise ValueError("Source binding reference identity does not match reference analysis.")

    finish_sha = sha256_file(finish_path)
    reference_sha = str(reference.get("sourceSha256", "")).strip().lower()
    if reference_sha != finish_sha.lower():
        raise ValueError("Finish media content identity does not match bound reference analysis.")

    duplicate_reasons = candidate_finish_duplicate_reasons(
        plan,
        plan_path,
        finish_path,
        candidate_signature=reference.get("perceptualSignature"),
        signature_provider=signature_provider,
    )
    if duplicate_reasons:
        raise ValueError(" ".join(duplicate_reasons))

    base = Path(case_dir) if case_dir else Path(safe_stem(case_id))
    if not base.is_absolute():
        base = Path(plan_path).resolve().parent / base
    base = base.resolve()
    retained_sources = [{
        "sourceId": source_id,
        "path": str(source_paths[source_id]),
    } for source_id in sorted(bound)]

    new_case = {
        "caseId": case_id,
        "difficultyTags": tags,
        "finishPath": str(finish_path),
        "sourceMedia": retained_sources,
        "sourceBinding": str(binding_path),
        "referenceAnalysis": str(reference_path),
        "truthDraft": str(base / "truth-draft.json"),
        "reviewPackDir": str(base / "review"),
        "retainedTruth": str(base / "truth-retained.json"),
        "matches": str(base / "matches.json"),
        "suiteManifest": str(base / "suite.json"),
    }
    updated = copy.deepcopy(plan)
    updated["cases"].append(new_case)
    ignored_sources = sorted(set(source_paths) - set(bound))
    return {
        "plan": updated,
        "admission": {
            "caseId": case_id,
            "boundSourceIds": sorted(bound),
            "ignoredUnboundSourceIds": ignored_sources,
            "candidateCaseCount": len(updated["cases"]),
            "coverageProjection": population_projection(updated),
        },
    }


def build_status(plan_path):
    plan = require_plan(plan_path)
    corpus = load_corpus_tool()
    results = [inspect_case(case, plan_path, corpus) for case in plan["cases"]]
    case_ids = [item["caseId"] for item in results if item["caseId"]]
    difficulty_counts = Counter(
        tag for item in results for tag in item["difficultyTags"] if tag in ALLOWED_DIFFICULTIES
    )
    population_reasons = []
    if len(results) < MIN_CASES:
        population_reasons.append(f"Population has fewer than {MIN_CASES} candidate cases.")
    if len(results) > MAX_CASES:
        population_reasons.append(f"Population exceeds the supported {MAX_CASES}-case window.")
    if len(case_ids) != len(set(case_ids)):
        population_reasons.append("Population reuses a case id.")
    population_reasons.extend(population_finish_identity_reasons(plan, plan_path))
    if len(difficulty_counts) < MIN_DIFFICULTY_KINDS:
        population_reasons.append(
            f"Population spans fewer than {MIN_DIFFICULTY_KINDS} hard-case categories."
        )
    coverage = population_coverage(plan, results, difficulty_counts)
    if coverage["distinctSourceSetCount"] < MIN_DISTINCT_SOURCE_SETS:
        population_reasons.append(
            f"Population spans fewer than {MIN_DISTINCT_SOURCE_SETS} distinct Start source sets."
        )
    stage_counts = Counter(item["stage"] for item in results)
    ready_count = sum(item["readyForCorpus"] for item in results)
    return {
        "schema": STATUS_SCHEMA,
        "editTypeId": str(plan["editTypeId"]).strip(),
        "candidateCaseCount": len(results),
        "readyForCorpusCount": ready_count,
        "populationWindowReached": not population_reasons,
        "populationReasons": population_reasons,
        "difficultyCounts": dict(sorted(difficulty_counts.items())),
        "coverage": coverage,
        "stageCounts": dict(sorted(stage_counts.items())),
        "cases": results,
    }


def build_work_queue(plan_path, finish_discovery_path=None):
    plan = require_plan(plan_path)
    status = build_status(plan_path)
    case_by_id = {
        str(case.get("caseId", "")).strip(): case
        for case in plan["cases"]
        if str(case.get("caseId", "")).strip()
    }
    action_priority = {
        "FINALIZE_INDEPENDENT_REVIEW": 10,
        "RUN_MATCHER_OBSERVATION": 20,
        "BUILD_SUITE_MANIFEST": 30,
        "COMPLETE_INDEPENDENT_REVIEW": 40,
        "CREATE_REVIEW_PACK": 50,
        "REBUILD_REVIEW_PACK": 50,
        "SCAFFOLD_TRUTH": 60,
        "REBUILD_TRUTH_SCAFFOLD": 60,
        "ANALYZE_REFERENCE": 70,
        "REBUILD_REFERENCE_ANALYSIS": 70,
        "FIX_MEDIA_INTAKE": 80,
        "NONE": 90,
    }
    queue = []
    remaining_review_shots = 0
    for observed in status["cases"]:
        case_id = observed["caseId"]
        case = case_by_id.get(case_id, {})
        total_shots = 0
        reference_path = artifact_path(case, plan_path, "referenceAnalysis")
        if reference_path is not None and reference_path.is_file():
            try:
                reference = load_json(reference_path)
                total_shots = len(reference.get("shots") or [])
            except (OSError, ValueError, json.JSONDecodeError):
                total_shots = 0

        incomplete_shot_ids = set()
        if observed["nextAction"] == "COMPLETE_INDEPENDENT_REVIEW":
            for reason in observed.get("reasons") or []:
                shot_id, separator, _detail = str(reason).partition(": ")
                if separator and shot_id.startswith("shot:"):
                    incomplete_shot_ids.add(shot_id)
            if not incomplete_shot_ids and total_shots:
                incomplete_shot_ids = {
                    "unknown:" + str(index)
                    for index in range(total_shots)
                }
        missing_shots = len(incomplete_shot_ids)
        remaining_review_shots += missing_shots
        completed_shots = max(0, total_shots - missing_shots)
        queue.append({
            "caseId": case_id,
            "stage": observed["stage"],
            "nextAction": observed["nextAction"],
            "readyForCorpus": bool(observed["readyForCorpus"]),
            "priorityRank": action_priority.get(observed["nextAction"], 100),
            "totalReferenceShotCount": total_shots,
            "completedIndependentReviewShotCount": completed_shots,
            "remainingIndependentReviewShotCount": missing_shots,
            "reasons": list(observed.get("reasons") or []),
        })

    queue.sort(key=lambda item: (
        item["priorityRank"],
        item["remainingIndependentReviewShotCount"],
        item["caseId"],
    ))
    coverage = status["coverage"]
    acquisition = {
        "additionalCasesNeededForMinimum": coverage["casesNeededForMinimum"],
        "additionalDistinctSourceSetsNeeded": coverage["sourceSetsNeeded"],
        "additionalDifficultyKindsNeeded": coverage["difficultyKindsNeeded"],
        "unrepresentedDifficultyKinds": coverage["unrepresentedDifficultyKinds"],
        "currentSourceSetCounts": coverage["sourceSetCounts"],
        "sourceAcquisitionRequired": coverage["sourceSetsNeeded"] > 0,
    }

    discovery_summary = None
    if finish_discovery_path:
        discovery = load_json(finish_discovery_path)
        if discovery.get("schema") != DISCOVERY_SCHEMA:
            raise ValueError("Finish discovery schema is invalid.")
        candidates = [
            item for item in discovery.get("candidates") or []
            if isinstance(item, dict)
        ]
        unbound_candidates = [
            {
                "path": str(item.get("path", "")).strip(),
                "fileName": str(item.get("fileName", "")).strip(),
                "sha256": str(item.get("sha256", "")).strip().lower(),
                "requiresReferenceAnalysis": item.get("requiresReferenceAnalysis") is True,
                "sourceBindingState": "MISSING_EXACT_BOUND_START_SOURCE",
            }
            for item in candidates
            if item.get("requiresSourceBinding") is True
        ]
        needs_binding = len(unbound_candidates)
        screened_unique_count = discovery.get("perceptuallyUniqueUnusedFinishCount")
        eligible_candidate_count = (
            int(screened_unique_count)
            if isinstance(screened_unique_count, int) and screened_unique_count >= 0
            else needs_binding
        )
        finish_candidate_shortfall = max(
            0,
            acquisition["additionalCasesNeededForMinimum"] - eligible_candidate_count,
        )
        discovery_summary = {
            "path": str(Path(finish_discovery_path).resolve()),
            "unusedFinishCandidateCount": len(candidates),
            "perceptuallyUniqueUnusedFinishCount": screened_unique_count,
            "candidatesRequiringSourceBindingCount": needs_binding,
            "unboundFinishCandidates": unbound_candidates,
            "canReachMinimumFromScreenedFinishPool": discovery.get(
                "canReachMinimumByScreenedUniqueFinishCount"
            ),
            "finishCandidateShortfallForMinimum": finish_candidate_shortfall,
        }
        acquisition["exactSourceBindingRequiredBeforeAdmission"] = needs_binding > 0
        acquisition["unboundFinishCandidateCount"] = needs_binding
        acquisition["finishCandidateShortfallForMinimum"] = finish_candidate_shortfall
        acquisition["sourceAcquisitionRequired"] = (
            acquisition["sourceAcquisitionRequired"]
            or acquisition["additionalCasesNeededForMinimum"] > 0
        )

    blockers = []
    if acquisition["additionalCasesNeededForMinimum"]:
        blockers.append(
            "Admit at least "
            + str(acquisition["additionalCasesNeededForMinimum"])
            + " additional exact-bound cases."
        )
    if acquisition.get("finishCandidateShortfallForMinimum", 0):
        blockers.append(
            "Discover at least "
            + str(acquisition["finishCandidateShortfallForMinimum"])
            + " additional perceptually unique Finish candidate(s) before the minimum cohort can be reached."
        )
    if acquisition["additionalDistinctSourceSetsNeeded"]:
        blockers.append(
            "Add raw Start media producing at least "
            + str(acquisition["additionalDistinctSourceSetsNeeded"])
            + " additional distinct source sets."
        )
    if acquisition["additionalDifficultyKindsNeeded"]:
        blockers.append(
            "Cover at least "
            + str(acquisition["additionalDifficultyKindsNeeded"])
            + " additional hard-case categories from: "
            + ", ".join(acquisition["unrepresentedDifficultyKinds"])
            + "."
        )
    if remaining_review_shots:
        blockers.append(
            "Complete "
            + str(remaining_review_shots)
            + " remaining matcher-blind shot annotations across prepared cases."
        )

    return {
        "schema": WORK_QUEUE_SCHEMA,
        "editTypeId": status["editTypeId"],
        "populationWindowReached": status["populationWindowReached"],
        "readyForCorpusCount": status["readyForCorpusCount"],
        "reviewableCaseCount": sum(
            item["nextAction"] == "COMPLETE_INDEPENDENT_REVIEW"
            for item in queue
        ),
        "readyToFinalizeCount": sum(
            item["nextAction"] == "FINALIZE_INDEPENDENT_REVIEW"
            for item in queue
        ),
        "remainingIndependentReviewShotCount": remaining_review_shots,
        "acquisition": acquisition,
        "finishDiscovery": discovery_summary,
        "blockingDependencies": blockers,
        "queue": queue,
    }


def _build_acquisition_tasks(plan_path, plan, acquisition, candidates):
    existing_case_ids = {
        str(case.get("caseId", "")).strip()
        for case in plan["cases"]
        if str(case.get("caseId", "")).strip()
    }
    used_case_ids = set(existing_case_ids)
    artifact_root = Path(plan_path).resolve().parent / "acquisition"
    required_difficulties = list(acquisition["unrepresentedDifficultyKinds"])
    source_sets_needed = int(acquisition["additionalDistinctSourceSetsNeeded"])
    difficulty_kinds_needed = int(acquisition["additionalDifficultyKindsNeeded"])
    tasks = []

    for index, candidate in enumerate(candidates):
        finish_path = str(candidate.get("path", "")).strip()
        finish_sha = str(candidate.get("sha256", "")).strip().lower()
        token = finish_sha[:12] if len(finish_sha) >= 12 else hashlib.sha256(
            finish_path.encode("utf-8")
        ).hexdigest()[:12]
        base_case_id = "retained-" + token
        case_id = base_case_id
        suffix = 2
        while case_id in used_case_ids:
            case_id = base_case_id + "-" + str(suffix)
            suffix += 1
        used_case_ids.add(case_id)
        case_root = artifact_root / case_id
        tasks.append({
            "priority": index + 1,
            "caseIdSuggestion": case_id,
            "finishPath": finish_path,
            "finishSha256": finish_sha,
            "sourceBindingState": candidate.get("sourceBindingState"),
            "requiredActions": [
                "ANALYZE_REFERENCE" if candidate.get("requiresReferenceAnalysis") else "REUSE_REFERENCE_ANALYSIS",
                "BIND_EXACT_START_SOURCE",
                "ADMIT_BOUND_CASE",
            ],
            "mustIncreaseDistinctSourceSets": index < source_sets_needed,
            "mustIncreaseDifficultyKinds": index < difficulty_kinds_needed,
            "preferredDifficultyKinds": required_difficulties,
            "artifactTargets": {
                "referenceAnalysis": str(case_root / "reference-analysis.json"),
                "sourceBinding": str(case_root / "source-binding.json"),
                "sourceMatches": str(case_root / "source-binding.matches.json"),
                "caseDir": str(case_root),
            },
        })
    return tasks


def _load_bindability_evidence(bindability_path=None, bindability_evidence=None):
    evidence = bindability_evidence
    if evidence is None and bindability_path:
        evidence = load_json(bindability_path)
    if evidence is None:
        return None, {}
    if evidence.get("schema") != ACQUISITION_BINDABILITY_SCHEMA:
        raise ValueError("Practice acquisition bindability evidence schema is invalid.")
    results = {}
    for item in evidence.get("candidateResults") or []:
        finish_sha = str(item.get("finishSha256", "")).strip().lower()
        if finish_sha:
            results[finish_sha] = item
    return evidence, results


def build_acquisition_plan(
    plan_path,
    finish_discovery_path,
    bindability_path=None,
    bindability_evidence=None,
):
    plan = require_plan(plan_path)
    queue = build_work_queue(plan_path, finish_discovery_path=finish_discovery_path)
    discovery = queue.get("finishDiscovery")
    if discovery is None:
        raise ValueError("Practice acquisition planning requires finish-discovery evidence.")

    acquisition = queue["acquisition"]
    target_count = int(acquisition["additionalCasesNeededForMinimum"])
    raw_candidates = list(discovery.get("unboundFinishCandidates") or [])
    evidence, bindability_by_sha = _load_bindability_evidence(
        bindability_path=bindability_path,
        bindability_evidence=bindability_evidence,
    )
    if evidence is None:
        eligible_candidates = raw_candidates
    else:
        eligible_candidates = [
            candidate
            for candidate in raw_candidates
            if str(
                bindability_by_sha.get(
                    str(candidate.get("sha256", "")).strip().lower(),
                    {},
                ).get("status", "")
            ).upper() == "BINDABLE"
        ]
    selected = eligible_candidates[:target_count] if target_count > 0 else []
    tasks = _build_acquisition_tasks(plan_path, plan, acquisition, selected)

    finish_shortfall = max(0, target_count - len(raw_candidates))
    bindable_count = len(eligible_candidates) if evidence is not None else 0
    bindable_shortfall = (
        max(0, target_count - bindable_count)
        if target_count > 0 and evidence is not None
        else (target_count if target_count > 0 else 0)
    )
    probed_count = len(bindability_by_sha)
    unprobed_count = (
        sum(
            1
            for candidate in raw_candidates
            if str(candidate.get("sha256", "")).strip().lower() not in bindability_by_sha
        )
        if evidence is not None
        else len(raw_candidates)
    )
    blockers = []
    if finish_shortfall:
        blockers.append(
            "Finish discovery is short by " + str(finish_shortfall)
            + " perceptually unique candidate(s) for the minimum retained cohort."
        )
    if target_count > 0 and evidence is None:
        blockers.append(
            "Raw Start-source bindability must be probed before Practice can treat the acquisition pool as executable."
        )
    elif bindable_shortfall:
        blockers.append(
            "Exact raw Start-source binding is short by " + str(bindable_shortfall)
            + " candidate(s) for the minimum retained cohort."
        )
    acquisition_ready = (
        finish_shortfall == 0
        and (target_count == 0 or (evidence is not None and bindable_shortfall == 0))
    )
    return {
        "schema": ACQUISITION_PLAN_SCHEMA,
        "editTypeId": str(plan["editTypeId"]).strip(),
        "targetNewCaseCount": target_count,
        "selectedCandidateCount": len(selected),
        "finishCandidateShortfallForMinimum": finish_shortfall,
        "candidatePoolReady": finish_shortfall == 0,
        "bindabilityVerified": evidence is not None,
        "bindabilityEvidencePath": (
            str(Path(bindability_path).expanduser().resolve()) if bindability_path else None
        ),
        "probedCandidateCount": probed_count,
        "unprobedCandidateCount": unprobed_count,
        "bindableCandidateCount": bindable_count,
        "bindableCandidateShortfallForMinimum": bindable_shortfall,
        "acquisitionReady": acquisition_ready,
        "sourceAcquisitionRequired": target_count > 0 and not acquisition_ready,
        "requiresExactSourceBinding": target_count > 0,
        "additionalDistinctSourceSetsNeeded": int(acquisition["additionalDistinctSourceSetsNeeded"]),
        "additionalDifficultyKindsNeeded": int(acquisition["additionalDifficultyKindsNeeded"]),
        "preferredDifficultyKinds": list(acquisition["unrepresentedDifficultyKinds"]),
        "blockingReasons": blockers,
        "tasks": tasks,
    }


def probe_acquisition_bindability(
    plan_path,
    finish_discovery_path,
    source_video_specs,
    matcher=None,
    source_binding_tool=None,
    cut_threshold=0.42,
    minimum_shot_ms=180.0,
    coarse_limit=16,
    minimum_coverage=0.98,
    index_cache_dir=None,
):
    if not (0.1 <= float(cut_threshold) <= 0.95):
        raise ValueError("Reference cut threshold must be in [0.1, 0.95].")
    if float(minimum_shot_ms) < 80:
        raise ValueError("Minimum reference shot duration must be at least 80 ms.")
    if int(coarse_limit) < 2 or int(coarse_limit) > 64:
        raise ValueError("Source-binding coarse limit must be in [2, 64].")
    if not (0.5 <= float(minimum_coverage) <= 1.0):
        raise ValueError("Source-binding minimum coverage must be in [0.5, 1.0].")

    plan = require_plan(plan_path)
    queue = build_work_queue(plan_path, finish_discovery_path=finish_discovery_path)
    discovery = queue.get("finishDiscovery")
    if discovery is None:
        raise ValueError("Practice bindability probing requires finish-discovery evidence.")
    acquisition = queue["acquisition"]
    target_count = int(acquisition["additionalCasesNeededForMinimum"])
    candidates = list(discovery.get("unboundFinishCandidates") or [])
    tasks = _build_acquisition_tasks(plan_path, plan, acquisition, candidates)
    source_paths = parse_source_video_specs(source_video_specs)
    normalized_sources = [
        source_id + "=" + str(source_paths[source_id])
        for source_id in sorted(source_paths)
    ]
    matcher = matcher or load_media_match_tool()
    source_binding_tool = source_binding_tool or load_source_binding_tool()
    cache_dir = (
        Path(index_cache_dir).expanduser().resolve()
        if index_cache_dir
        else Path(plan_path).resolve().parent / ".source-index-cache"
    )
    results = []

    for task in tasks:
        result = {
            "caseIdSuggestion": task["caseIdSuggestion"],
            "finishPath": task["finishPath"],
            "finishSha256": task["finishSha256"],
            "status": "UNBINDABLE",
            "boundSourceIds": [],
            "reasons": [],
        }
        finish_path = Path(task["finishPath"]).expanduser().resolve()
        if not finish_path.is_file():
            result["reasons"].append("Finish media is missing: " + str(finish_path))
            results.append(result)
            continue
        actual_sha = sha256_file(finish_path)
        if task["finishSha256"] and actual_sha.lower() != task["finishSha256"].lower():
            result["reasons"].append("Finish media SHA-256 changed after discovery.")
            results.append(result)
            continue

        targets = task["artifactTargets"]
        reference_path = Path(targets["referenceAnalysis"]).resolve()
        binding_path = Path(targets["sourceBinding"]).resolve()
        matches_path = Path(targets["sourceMatches"]).resolve()
        reference = None
        if reference_path.is_file():
            try:
                candidate = load_json(reference_path)
                if (
                    candidate.get("schema") == REFERENCE_SCHEMA
                    and str(candidate.get("sourceSha256", "")).strip().lower() == actual_sha.lower()
                ):
                    reference = candidate
            except (OSError, ValueError, json.JSONDecodeError):
                reference = None
        if reference is None:
            try:
                reference_path.parent.mkdir(parents=True, exist_ok=True)
                reference = matcher.analyze_reference(
                    str(finish_path),
                    "reference:" + task["caseIdSuggestion"],
                    str(reference_path),
                    float(cut_threshold),
                    float(minimum_shot_ms),
                )
            except Exception as error:
                result["reasons"].append("Reference analysis failed: " + str(error))
                results.append(result)
                continue

        try:
            binding = source_binding_tool.bind_sources(
                str(reference_path),
                str(binding_path),
                source_video_specs=normalized_sources,
                index_cache_dir=str(cache_dir),
                matches_output=str(matches_path),
                coarse_limit=int(coarse_limit),
                minimum_coverage=float(minimum_coverage),
            )
        except Exception as error:
            result["reasons"].append("Exact Start-source binding failed: " + str(error))
            results.append(result)
            continue
        if binding.get("status") == "BOUND":
            try:
                bound = validate_bound_sources(binding, source_paths)
            except ValueError as error:
                result["reasons"].append(str(error))
                results.append(result)
                continue
            result["status"] = "BINDABLE"
            result["boundSourceIds"] = sorted(bound)
        else:
            result["reasons"].extend(
                str(reason).strip()
                for reason in binding.get("reasons") or ["No exact Start-source binding qualified."]
                if str(reason).strip()
            )
        results.append(result)

    bindable = [item for item in results if item["status"] == "BINDABLE"]
    blocked = [item for item in results if item["status"] != "BINDABLE"]
    return {
        "schema": ACQUISITION_BINDABILITY_SCHEMA,
        "editTypeId": str(plan["editTypeId"]).strip(),
        "targetNewCaseCount": target_count,
        "sourceIds": sorted(source_paths),
        "candidateCount": len(results),
        "bindableCandidateCount": len(bindable),
        "unboundCandidateCount": len(blocked),
        "canMeetMinimumByBindableCandidateCount": len(bindable) >= target_count,
        "sourceAcquisitionQueue": [
            {
                "caseIdSuggestion": item["caseIdSuggestion"],
                "finishPath": item["finishPath"],
                "finishSha256": item["finishSha256"],
                "reasons": item["reasons"],
            }
            for item in blocked
        ],
        "candidateResults": results,
    }


def execute_acquisition_plan(
    plan_path,
    finish_discovery_path,
    output_plan_path,
    source_video_specs,
    difficulty_specs=None,
    case_ids=None,
    matcher=None,
    source_binding_tool=None,
    signature_provider=None,
    bindability_path=None,
    cut_threshold=0.42,
    minimum_shot_ms=180.0,
    coarse_limit=16,
    minimum_coverage=0.98,
    index_cache_dir=None,
):
    if not (0.1 <= float(cut_threshold) <= 0.95):
        raise ValueError("Reference cut threshold must be in [0.1, 0.95].")
    if float(minimum_shot_ms) < 80:
        raise ValueError("Minimum reference shot duration must be at least 80 ms.")
    if int(coarse_limit) < 2 or int(coarse_limit) > 64:
        raise ValueError("Source-binding coarse limit must be in [2, 64].")
    if not (0.5 <= float(minimum_coverage) <= 1.0):
        raise ValueError("Source-binding minimum coverage must be in [0.5, 1.0].")

    source_paths = parse_source_video_specs(source_video_specs)
    normalized_sources = [
        source_id + "=" + str(source_paths[source_id])
        for source_id in sorted(source_paths)
    ]
    difficulty_map = parse_acquisition_difficulty_specs(difficulty_specs)
    acquisition = build_acquisition_plan(
        plan_path,
        finish_discovery_path,
        bindability_path=bindability_path,
    )
    tasks = list(acquisition["tasks"])
    task_ids = {str(item["caseIdSuggestion"]) for item in tasks}
    unknown_difficulties = sorted(set(difficulty_map) - task_ids)
    if unknown_difficulties:
        raise ValueError(
            "Difficulty evidence references unknown acquisition case(s): "
            + ", ".join(unknown_difficulties)
        )

    selected_ids = None
    if case_ids:
        selected_ids = {str(item).strip() for item in case_ids if str(item).strip()}
        unknown = sorted(selected_ids - task_ids)
        if unknown:
            raise ValueError("Unknown acquisition case id(s): " + ", ".join(unknown))
        tasks = [item for item in tasks if item["caseIdSuggestion"] in selected_ids]

    output_plan = Path(output_plan_path).expanduser().resolve()
    if output_plan == Path(plan_path).expanduser().resolve():
        raise ValueError("Acquisition execution must write a new population plan path.")
    write_json(output_plan, require_plan(plan_path))

    matcher = matcher or load_media_match_tool()
    source_binding_tool = source_binding_tool or load_source_binding_tool()
    cache_dir = (
        Path(index_cache_dir).expanduser().resolve()
        if index_cache_dir
        else output_plan.parent / ".source-index-cache"
    )
    task_results = []

    for task in tasks:
        case_id = str(task["caseIdSuggestion"])
        result = {
            "caseId": case_id,
            "finishPath": task["finishPath"],
            "status": "BLOCKED",
            "reasons": [],
        }
        tags = list(difficulty_map.get(case_id) or [])
        if not tags:
            result["reasons"].append(
                "Verified difficulty evidence is required before retained-corpus admission."
            )
            task_results.append(result)
            continue
        if task.get("mustIncreaseDifficultyKinds") and not (
            set(tags) & set(task.get("preferredDifficultyKinds") or [])
        ):
            result["reasons"].append(
                "This acquisition slot must add a currently unrepresented hard-case category."
            )
            task_results.append(result)
            continue

        finish_path = Path(task["finishPath"]).expanduser().resolve()
        if not finish_path.is_file():
            result["reasons"].append("Finish media is missing: " + str(finish_path))
            task_results.append(result)
            continue
        finish_sha = sha256_file(finish_path)
        expected_finish_sha = str(task.get("finishSha256", "")).strip().lower()
        if expected_finish_sha and finish_sha.lower() != expected_finish_sha:
            result["reasons"].append("Finish media SHA-256 changed after discovery.")
            task_results.append(result)
            continue

        targets = task["artifactTargets"]
        reference_path = Path(targets["referenceAnalysis"]).resolve()
        binding_path = Path(targets["sourceBinding"]).resolve()
        matches_path = Path(targets["sourceMatches"]).resolve()
        reference = None
        if reference_path.is_file():
            try:
                candidate = load_json(reference_path)
                if (
                    candidate.get("schema") == REFERENCE_SCHEMA
                    and str(candidate.get("sourceSha256", "")).strip().lower() == finish_sha.lower()
                ):
                    reference = candidate
            except (OSError, ValueError, json.JSONDecodeError):
                reference = None
        if reference is None:
            try:
                reference_path.parent.mkdir(parents=True, exist_ok=True)
                reference = matcher.analyze_reference(
                    str(finish_path),
                    "reference:" + case_id,
                    str(reference_path),
                    float(cut_threshold),
                    float(minimum_shot_ms),
                )
            except Exception as error:
                result["reasons"].append("Reference analysis failed: " + str(error))
                task_results.append(result)
                continue

        try:
            binding = source_binding_tool.bind_sources(
                str(reference_path),
                str(binding_path),
                source_video_specs=normalized_sources,
                index_cache_dir=str(cache_dir),
                matches_output=str(matches_path),
                coarse_limit=int(coarse_limit),
                minimum_coverage=float(minimum_coverage),
            )
        except Exception as error:
            result["reasons"].append("Exact Start-source binding failed: " + str(error))
            task_results.append(result)
            continue
        if binding.get("status") != "BOUND":
            result["reasons"].extend(
                str(reason).strip()
                for reason in binding.get("reasons") or ["No exact Start-source binding qualified."]
                if str(reason).strip()
            )
            task_results.append(result)
            continue

        before = population_projection(require_plan(output_plan))
        try:
            admission = admit_bound_case(
                output_plan,
                case_id,
                finish_path,
                binding_path,
                normalized_sources,
                tags,
                case_dir=targets["caseDir"],
                signature_provider=signature_provider,
            )
        except Exception as error:
            result["reasons"].append("Retained-corpus admission failed: " + str(error))
            task_results.append(result)
            continue
        after = admission["admission"]["coverageProjection"]
        if (
            task.get("mustIncreaseDistinctSourceSets")
            and after["distinctSourceSetCount"] <= before["distinctSourceSetCount"]
        ):
            result["reasons"].append(
                "This acquisition slot must increase distinct Start-source-set coverage."
            )
            task_results.append(result)
            continue
        if (
            task.get("mustIncreaseDifficultyKinds")
            and len(after["representedDifficultyKinds"]) <= len(before["representedDifficultyKinds"])
        ):
            result["reasons"].append(
                "This acquisition slot did not increase verified hard-case-category coverage."
            )
            task_results.append(result)
            continue

        write_json(output_plan, admission["plan"])
        result.update({
            "status": "ADMITTED",
            "reasons": [],
            "difficultyTags": tags,
            "boundSourceIds": admission["admission"]["boundSourceIds"],
            "coverageProjection": after,
            "referenceAnalysis": str(reference_path),
            "sourceBinding": str(binding_path),
            "sourceMatches": str(matches_path),
        })
        task_results.append(result)

    admitted_count = sum(item["status"] == "ADMITTED" for item in task_results)
    blocked_count = len(task_results) - admitted_count
    final_plan = require_plan(output_plan)
    return {
        "schema": ACQUISITION_RUN_SCHEMA,
        "editTypeId": str(final_plan["editTypeId"]).strip(),
        "outputPlanPath": str(output_plan),
        "candidatePoolReady": acquisition["candidatePoolReady"],
        "bindabilityVerified": acquisition.get("bindabilityVerified", False),
        "acquisitionReady": acquisition.get("acquisitionReady", acquisition["candidatePoolReady"]),
        "selectedTaskCount": len(task_results),
        "admittedCount": admitted_count,
        "blockedCount": blocked_count,
        "sourceIds": sorted(source_paths),
        "coverageProjection": population_projection(final_plan),
        "tasks": task_results,
    }


def build_progression_gate(plan_path, finish_discovery_path=None):
    status = build_status(plan_path)
    queue = build_work_queue(plan_path, finish_discovery_path=finish_discovery_path)
    candidate_count = int(status["candidateCaseCount"])
    ready_count = int(status["readyForCorpusCount"])
    pending = [item for item in queue["queue"] if item["nextAction"] != "NONE"]
    pending_action_counts = Counter(item["nextAction"] for item in pending)
    acquisition = queue["acquisition"]

    reasons = []
    if not status["populationWindowReached"]:
        reasons.extend(status["populationReasons"])
    if candidate_count < MIN_CASES:
        reasons.append(
            "Practice retained evaluation requires at least "
            + str(MIN_CASES)
            + " planned real-media cases."
        )
    if candidate_count > MAX_CASES:
        reasons.append(
            "Practice retained evaluation supports at most "
            + str(MAX_CASES)
            + " planned real-media cases."
        )
    if ready_count != candidate_count:
        reasons.append(
            str(candidate_count - ready_count)
            + " planned case(s) are not READY_FOR_CORPUS."
        )
    if queue["remainingIndependentReviewShotCount"] > 0:
        reasons.append(
            str(queue["remainingIndependentReviewShotCount"])
            + " matcher-blind shot annotation(s) remain incomplete."
        )
    if acquisition.get("finishCandidateShortfallForMinimum", 0) > 0:
        reasons.append(
            str(acquisition["finishCandidateShortfallForMinimum"])
            + " additional perceptually unique Finish candidate(s) are required."
        )
    if acquisition["additionalDistinctSourceSetsNeeded"] > 0:
        reasons.append(
            str(acquisition["additionalDistinctSourceSetsNeeded"])
            + " additional distinct Start source set(s) are required."
        )
    if acquisition["additionalDifficultyKindsNeeded"] > 0:
        reasons.append(
            str(acquisition["additionalDifficultyKindsNeeded"])
            + " additional hard-case difficulty kind(s) are required."
        )
    if pending:
        reasons.append(
            str(len(pending))
            + " planned case(s) still require progression work before retained evaluation."
        )
    reasons = list(dict.fromkeys(str(reason).strip() for reason in reasons if str(reason).strip()))
    retained_evaluation_allowed = len(reasons) == 0

    return {
        "schema": PROGRESSION_GATE_SCHEMA,
        "editTypeId": status["editTypeId"],
        "retainedEvaluationAllowed": retained_evaluation_allowed,
        "robustPopulationPrerequisiteSatisfied": retained_evaluation_allowed,
        "candidateCaseCount": candidate_count,
        "readyForCorpusCount": ready_count,
        "pendingCaseCount": len(pending),
        "remainingIndependentReviewShotCount": queue["remainingIndependentReviewShotCount"],
        "pendingActionCounts": dict(sorted(pending_action_counts.items())),
        "acquisition": {
            "additionalCasesNeededForMinimum": acquisition["additionalCasesNeededForMinimum"],
            "additionalDistinctSourceSetsNeeded": acquisition["additionalDistinctSourceSetsNeeded"],
            "additionalDifficultyKindsNeeded": acquisition["additionalDifficultyKindsNeeded"],
            "finishCandidateShortfallForMinimum": acquisition.get(
                "finishCandidateShortfallForMinimum", 0
            ),
            "exactSourceBindingRequiredBeforeAdmission": acquisition.get(
                "exactSourceBindingRequiredBeforeAdmission", False
            ),
            "sourceAcquisitionRequired": acquisition["sourceAcquisitionRequired"],
        },
        "blockingReasons": reasons,
    }


def _case_source_paths(case, manifest_path):
    paths = {}
    for item in case.get("sourceMedia") or []:
        if not isinstance(item, dict):
            continue
        source_id = str(item.get("sourceId", "")).strip()
        source_path = resolve_path(manifest_path, item.get("path"))
        if not source_id or source_path is None or not source_path.is_file():
            raise ValueError("Start source media is missing or invalid.")
        if source_id in paths:
            raise ValueError(f"Duplicate Start source id in population case: {source_id}")
        paths[source_id] = str(source_path)
    if not paths:
        raise ValueError("Population case contains no Start source media.")
    return paths


def finalize_independent_reviews(
    plan_path,
    annotation_origin,
    case_ids=None,
    force=False,
    media_truth=None,
):
    plan = require_plan(plan_path)
    annotation_origin = str(annotation_origin).strip()
    if annotation_origin not in ALLOWED_ANNOTATION_ORIGINS:
        raise ValueError("Independent annotation origin is invalid.")

    requested_case_ids = {
        str(item).strip() for item in (case_ids or []) if str(item).strip()
    }
    cases = list(plan["cases"])
    if requested_case_ids:
        known_case_ids = {str(item.get("caseId", "")).strip() for item in cases}
        unknown = sorted(requested_case_ids - known_case_ids)
        if unknown:
            raise ValueError("Unknown population case id(s): " + ", ".join(unknown))
        cases = [
            item for item in cases
            if str(item.get("caseId", "")).strip() in requested_case_ids
        ]

    media_truth = media_truth or load_media_truth_tool()
    results = []
    for case in cases:
        case_id = str(case.get("caseId", "")).strip() or "<missing-case-id>"
        try:
            finish_path = artifact_path(case, plan_path, "finishPath")
            reference_path = artifact_path(case, plan_path, "referenceAnalysis")
            draft_path = artifact_path(case, plan_path, "truthDraft")
            review_dir = artifact_path(case, plan_path, "reviewPackDir")
            retained_path = artifact_path(case, plan_path, "retainedTruth")
            if finish_path is None or not finish_path.is_file():
                raise ValueError("Finish media is missing.")
            if reference_path is None or not reference_path.is_file():
                raise ValueError("Reference analysis is missing.")
            if draft_path is None or not draft_path.is_file():
                raise ValueError("Truth draft is missing.")
            if review_dir is None:
                raise ValueError("Review-pack directory is missing.")
            if retained_path is None:
                raise ValueError("Retained-truth path is missing.")

            reference = load_json(reference_path)
            draft = load_json(draft_path)
            source_paths = _case_source_paths(case, plan_path)
            source_hashes = {
                source_id: sha256_file(source_path)
                for source_id, source_path in source_paths.items()
            }
            finish_sha = sha256_file(finish_path)
            existing_attestation_reasons = review_attestation_validation_reasons(
                review_dir,
                retained_truth_path=retained_path if retained_path.is_file() else None,
                expected_annotation_origin=annotation_origin,
                expected_case_id=case_id,
                expected_finish_sha256=finish_sha,
                expected_source_sha256_by_id=source_hashes,
            )
            if retained_path.is_file() and not existing_attestation_reasons and not force:
                results.append({
                    "caseId": case_id,
                    "status": "SKIPPED_ALREADY_FINALIZED",
                    "retainedTruth": str(retained_path),
                    "reviewAttestation": str(review_dir / "review-attestation.json"),
                })
                continue
            if retained_path.is_file() and not force:
                raise ValueError(
                    "Retained truth already exists but its matcher-blind attestation is invalid or stale; "
                    "rerun with --force only after rechecking the independent review."
                )
            if not review_pack_preparation_complete(
                review_dir,
                sorted(source_paths),
                expected_source_sha256=source_hashes,
                expected_finish_sha256=finish_sha,
                require_source_atlas=True,
            ):
                raise ValueError(
                    "Review pack is incomplete, stale, or not bound to the current Finish/Start media."
                )
            policy_reasons = review_pack_matcher_blind_reasons(review_dir)
            if policy_reasons:
                raise ValueError(" ".join(policy_reasons))

            worksheet_path = review_dir / "annotations.csv"
            review_reasons = worksheet_validation_reasons(
                worksheet_path,
                draft,
                reference,
            )
            if review_reasons:
                raise ValueError(
                    "Independent review worksheet is not complete: " + " ".join(review_reasons)
                )

            imported = media_truth.import_review_csv(draft, reference, worksheet_path)
            retained = media_truth.retain(
                imported,
                reference,
                sorted(source_paths),
                source_hashes,
                annotation_origin,
            )
            write_json(retained_path, retained)

            invalidated = []
            for key in ("matches", "suiteManifest"):
                downstream = artifact_path(case, plan_path, key)
                if downstream is not None and downstream.is_file():
                    downstream.unlink()
                    invalidated.append(key)

            review_pack_path = review_dir / "review-pack.json"
            attestation = {
                "schema": REVIEW_ATTESTATION_SCHEMA,
                "caseId": case_id,
                "annotationOrigin": annotation_origin,
                "matcherBlindWorkflowVerified": True,
                "reviewPackSha256": sha256_file(review_pack_path),
                "worksheetSha256": sha256_file(worksheet_path),
                "retainedTruthSha256": sha256_file(retained_path),
                "finishSha256": finish_sha,
                "sourceSha256ById": dict(sorted(source_hashes.items())),
                "finalizedAt": now_iso(),
                "invalidatedDownstreamArtifacts": invalidated,
            }
            attestation_path = review_dir / "review-attestation.json"
            write_json(attestation_path, attestation)
            results.append({
                "caseId": case_id,
                "status": "FINALIZED",
                "retainedTruth": str(retained_path),
                "reviewAttestation": str(attestation_path),
                "invalidatedDownstreamArtifacts": invalidated,
                "nextAction": "RUN_MATCHER_OBSERVATION",
            })
        except Exception as exc:
            results.append({
                "caseId": case_id,
                "status": "FAILED",
                "error": str(exc),
            })

    finalized_count = sum(item["status"] == "FINALIZED" for item in results)
    failed_count = sum(item["status"] == "FAILED" for item in results)
    skipped_count = sum(item["status"] == "SKIPPED_ALREADY_FINALIZED" for item in results)
    return {
        "schema": FINALIZE_SCHEMA,
        "annotationOrigin": annotation_origin,
        "finalizedCount": finalized_count,
        "skippedCount": skipped_count,
        "failedCount": failed_count,
        "cases": results,
    }


def prepare_review_packs(
    plan_path,
    source_atlas_interval_ms=DEFAULT_SOURCE_ATLAS_INTERVAL_MS,
    source_atlas_max_frames=DEFAULT_SOURCE_ATLAS_MAX_FRAMES,
    source_atlas_cache_dir=None,
    force=False,
    case_ids=None,
    media_truth=None,
):
    plan = require_plan(plan_path)
    requested_case_ids = {
        str(item).strip() for item in (case_ids or []) if str(item).strip()
    }
    cases = list(plan["cases"])
    if requested_case_ids:
        known_case_ids = {str(item.get("caseId", "")).strip() for item in cases}
        unknown = sorted(requested_case_ids - known_case_ids)
        if unknown:
            raise ValueError("Unknown population case id(s): " + ", ".join(unknown))
        cases = [
            item for item in cases
            if str(item.get("caseId", "")).strip() in requested_case_ids
        ]
    media_truth = media_truth or load_media_truth_tool()
    interval_ms = float(source_atlas_interval_ms)
    max_frames = int(source_atlas_max_frames)
    if interval_ms < 0.0:
        raise ValueError("Source-atlas interval cannot be negative.")
    if max_frames < 1:
        raise ValueError("Source-atlas max frame count must be at least 1.")
    cache_dir = None
    if interval_ms > 0.0:
        cache_dir = (
            Path(source_atlas_cache_dir).expanduser().resolve()
            if source_atlas_cache_dir
            else Path(plan_path).resolve().parent / ".source-atlas-cache"
        )

    results = []
    source_sha_cache = {}
    for case in cases:
        case_id = str(case.get("caseId", "")).strip() or "<missing-case-id>"
        review_dir = artifact_path(case, plan_path, "reviewPackDir")
        expected_source_ids = source_ids(case)
        needs_atlas = interval_ms > 0.0
        try:
            if review_dir is None:
                raise ValueError("reviewPackDir is missing.")
            finish_path = artifact_path(case, plan_path, "finishPath")
            reference_path = artifact_path(case, plan_path, "referenceAnalysis")
            draft_path = artifact_path(case, plan_path, "truthDraft")
            if finish_path is None or not finish_path.is_file():
                raise ValueError("Finish media is missing.")
            source_paths = _case_source_paths(case, plan_path)
            source_hashes = {}
            cached_hasher = getattr(media_truth, "sha256_file_cached", sha256_file)
            for source_id, source_path in source_paths.items():
                source_key = str(Path(source_path).resolve())
                if source_key not in source_sha_cache:
                    source_sha_cache[source_key] = cached_hasher(source_key)
                source_hashes[source_id] = source_sha_cache[source_key]
            finish_key = str(Path(finish_path).resolve())
            if finish_key not in source_sha_cache:
                source_sha_cache[finish_key] = cached_hasher(finish_key)
            finish_sha256 = source_sha_cache[finish_key]
            if not force and review_pack_preparation_complete(
                review_dir,
                expected_source_ids,
                expected_source_sha256=source_hashes,
                expected_finish_sha256=finish_sha256,
                require_source_atlas=needs_atlas,
            ):
                results.append({
                    "caseId": case_id,
                    "status": "SKIPPED",
                    "reason": "Review pack already satisfies requested preparation and media identities.",
                })
                continue
            if reference_path is None or not reference_path.is_file():
                raise ValueError("Reference analysis is missing.")
            if draft_path is None:
                raise ValueError("truthDraft path is missing from the population case.")
            reference = load_json(reference_path)
            scaffold_created = False
            if not draft_path.is_file():
                draft = media_truth.scaffold(reference, sorted(source_paths), source_hashes)
                draft_path.parent.mkdir(parents=True, exist_ok=True)
                draft_path.write_text(
                    json.dumps(draft, indent=2) + "\n",
                    encoding="utf-8",
                    newline="\n",
                )
                scaffold_created = True
            else:
                draft = load_json(draft_path)
            manifest = media_truth.build_review_pack(
                reference=reference,
                draft=draft,
                finish_path=str(finish_path),
                source_paths_by_id=source_paths,
                output_dir=review_dir,
                source_atlas_interval_ms=(interval_ms if needs_atlas else None),
                source_atlas_max_frames=max_frames,
                source_atlas_cache_dir=(None if cache_dir is None else str(cache_dir)),
            )
            invalidated = []
            attestation_path = review_dir / "review-attestation.json"
            if attestation_path.is_file():
                attestation_path.unlink()
                invalidated.append("reviewAttestation")
            for key in ("retainedTruth", "matches", "suiteManifest"):
                downstream = artifact_path(case, plan_path, key)
                if downstream is not None and downstream.is_file():
                    downstream.unlink()
                    invalidated.append(key)
            results.append({
                "caseId": case_id,
                "status": "PREPARED",
                "reviewPack": str(review_dir / "review-pack.json"),
                "truthScaffoldCreated": scaffold_created,
                "sourceAtlasCount": len(manifest.get("sourceAtlas") or []),
                "invalidatedArtifacts": invalidated,
            })
        except Exception as exc:
            results.append({"caseId": case_id, "status": "FAILED", "reason": str(exc)})

    counts = Counter(item["status"] for item in results)
    return {
        "schema": PREPARE_SCHEMA,
        "editTypeId": str(plan["editTypeId"]).strip(),
        "preparedCount": counts.get("PREPARED", 0),
        "skippedCount": counts.get("SKIPPED", 0),
        "failedCount": counts.get("FAILED", 0),
        "sourceAtlasCacheDir": None if cache_dir is None else str(cache_dir),
        "cases": results,
    }


def selected_population_cases(plan, case_ids=None):
    requested = {
        str(item).strip() for item in (case_ids or []) if str(item).strip()
    }
    cases = list(plan["cases"])
    if not requested:
        return cases
    known = {str(item.get("caseId", "")).strip() for item in cases}
    unknown = sorted(requested - known)
    if unknown:
        raise ValueError("Unknown population case id(s): " + ", ".join(unknown))
    return [
        item for item in cases
        if str(item.get("caseId", "")).strip() in requested
    ]


def matcher_source_index_compatible(
    matcher,
    index_path,
    source_id,
    source_sha256,
    sample_step_ms,
    analysis_fps,
):
    index_path = Path(index_path)
    if not index_path.is_file():
        return False
    try:
        payload = matcher.load_artifact(index_path, "editflow.practice-source-index.v1")
    except Exception:
        return False
    analysis = payload.get("analysis") or {}
    return (
        str(payload.get("sourceId", "")).strip() == str(source_id).strip()
        and str(payload.get("sourceSha256", "")).strip().lower()
        == str(source_sha256).strip().lower()
        and math.isclose(
            float(analysis.get("sampleStepMs", -1.0)),
            float(sample_step_ms),
            rel_tol=0.0,
            abs_tol=1e-6,
        )
        and math.isclose(
            float(analysis.get("analysisProxyFps", -1.0)),
            float(analysis_fps),
            rel_tol=0.0,
            abs_tol=1e-3,
        )
    )


def run_matcher_observations(
    plan_path,
    case_ids=None,
    matcher=None,
    media_truth=None,
    cache_dir=None,
    sample_step_ms=DEFAULT_MATCHER_SAMPLE_STEP_MS,
    analysis_fps=DEFAULT_MATCHER_ANALYSIS_FPS,
    coarse_limit=DEFAULT_MATCHER_COARSE_LIMIT,
):
    plan = require_plan(plan_path)
    cases = selected_population_cases(plan, case_ids)
    matcher = matcher or load_media_match_tool()
    media_truth = media_truth or load_media_truth_tool()
    sample_step_ms = float(sample_step_ms)
    analysis_fps = float(analysis_fps)
    coarse_limit = int(coarse_limit)
    if sample_step_ms <= 0.0 or analysis_fps <= 0.0 or coarse_limit < 1:
        raise ValueError("Matcher observation settings must be positive.")
    cache_root = (
        Path(cache_dir).expanduser().resolve()
        if cache_dir
        else Path(plan_path).resolve().parent / ".matcher-cache"
    )
    results = []
    for case in cases:
        case_id = str(case.get("caseId", "")).strip() or "<missing-case-id>"
        try:
            finish_path = artifact_path(case, plan_path, "finishPath")
            reference_path = artifact_path(case, plan_path, "referenceAnalysis")
            retained_path = artifact_path(case, plan_path, "retainedTruth")
            review_dir = artifact_path(case, plan_path, "reviewPackDir")
            matches_path = artifact_path(case, plan_path, "matches")
            if finish_path is None or not finish_path.is_file():
                raise ValueError("Finish media is missing.")
            if reference_path is None or not reference_path.is_file():
                raise ValueError("Reference analysis is missing.")
            if retained_path is None or not retained_path.is_file():
                raise ValueError("Retained independent truth is missing.")
            if review_dir is None:
                raise ValueError("Review-pack directory is missing.")
            if matches_path is None:
                raise ValueError("Matcher observation path is missing.")

            reference = matcher.load_artifact(reference_path, REFERENCE_SCHEMA)
            retained = load_json(retained_path)
            source_paths = _case_source_paths(case, plan_path)
            source_hashes = {
                source_id: sha256_file(source_path)
                for source_id, source_path in source_paths.items()
            }
            finish_sha = sha256_file(finish_path)
            truth_errors = media_truth.validate_truth(
                retained,
                reference,
                allowed_source_ids=sorted(source_paths),
                allowed_source_sha256_by_id=source_hashes,
                require_retained=True,
            )
            if truth_errors:
                raise ValueError("Retained independent truth is invalid: " + " ".join(truth_errors))
            if str(retained.get("referenceSourceSha256", "")).strip().lower() != finish_sha:
                raise ValueError("Finish media bytes changed after independent truth retention.")
            attestation_reasons = review_attestation_validation_reasons(
                review_dir,
                retained_truth_path=retained_path,
                expected_annotation_origin=retained.get("annotationOrigin"),
                expected_case_id=case_id,
                expected_finish_sha256=finish_sha,
                expected_source_sha256_by_id=source_hashes,
            )
            if attestation_reasons:
                raise ValueError(
                    "Matcher is blocked until independent review authority is current: "
                    + " ".join(attestation_reasons)
                )

            if matches_path.is_file():
                try:
                    existing = matcher.load_artifact(matches_path, MATCH_SCHEMA)
                    if existing.get("schema") == MATCH_SCHEMA:
                        results.append({
                            "caseId": case_id,
                            "status": "SKIPPED_ALREADY_MATCHED",
                            "matches": str(matches_path),
                        })
                        continue
                except Exception:
                    pass

            fingerprint = matcher.analyzer_fingerprint()
            fingerprint_cache = cache_root / safe_stem(fingerprint)[:32]
            source_indexes = []
            for source_id, source_path in sorted(source_paths.items()):
                source_sha = source_hashes[source_id]
                index_path = fingerprint_cache / (
                    "source-" + safe_stem(source_id) + "-" + source_sha[:20] + ".json"
                )
                if not matcher_source_index_compatible(
                    matcher,
                    index_path,
                    source_id,
                    source_sha,
                    sample_step_ms,
                    analysis_fps,
                ):
                    index_path.parent.mkdir(parents=True, exist_ok=True)
                    matcher.index_source(
                        source_path,
                        source_id,
                        index_path,
                        sample_step_ms,
                        proxy_dir=fingerprint_cache / "proxy",
                        analysis_fps=analysis_fps,
                    )
                source_indexes.append(index_path)
            if matcher.analyzer_fingerprint() != fingerprint:
                raise RuntimeError("Practice matcher changed while source indexes were being prepared.")

            matches_path.parent.mkdir(parents=True, exist_ok=True)
            payload = matcher.match_reference(
                reference_path,
                source_indexes,
                matches_path,
                coarse_limit,
            )
            if payload.get("schema") != MATCH_SCHEMA:
                raise ValueError("Matcher observation schema is invalid.")
            if matcher.analyzer_fingerprint() != fingerprint:
                matches_path.unlink(missing_ok=True)
                raise RuntimeError("Practice matcher changed during matcher observation.")
            post_reasons = review_attestation_validation_reasons(
                review_dir,
                retained_truth_path=retained_path,
                expected_annotation_origin=retained.get("annotationOrigin"),
                expected_case_id=case_id,
                expected_finish_sha256=finish_sha,
                expected_source_sha256_by_id=source_hashes,
            )
            if post_reasons:
                matches_path.unlink(missing_ok=True)
                raise ValueError(
                    "Independent review authority changed during matcher observation: "
                    + " ".join(post_reasons)
                )
            suite_path = artifact_path(case, plan_path, "suiteManifest")
            if suite_path is not None and suite_path.is_file():
                suite_path.unlink()
            results.append({
                "caseId": case_id,
                "status": "MATCHED",
                "matches": str(matches_path),
                "matcherAnalyzerFingerprint": fingerprint,
                "sourceIndexCount": len(source_indexes),
            })
        except Exception as exc:
            results.append({"caseId": case_id, "status": "FAILED", "error": str(exc)})
    counts = Counter(item["status"] for item in results)
    return {
        "schema": MATCHER_OBSERVATION_SCHEMA,
        "editTypeId": str(plan["editTypeId"]).strip(),
        "matchedCount": counts.get("MATCHED", 0),
        "skippedCount": counts.get("SKIPPED_ALREADY_MATCHED", 0),
        "failedCount": counts.get("FAILED", 0),
        "matcherCacheDir": str(cache_root),
        "cases": results,
    }


def build_suite_manifests(
    plan_path,
    case_ids=None,
    media_truth=None,
    corpus=None,
):
    plan = require_plan(plan_path)
    cases = selected_population_cases(plan, case_ids)
    media_truth = media_truth or load_media_truth_tool()
    corpus = corpus or load_corpus_tool()
    results = []
    for case in cases:
        case_id = str(case.get("caseId", "")).strip() or "<missing-case-id>"
        try:
            finish_path = artifact_path(case, plan_path, "finishPath")
            reference_path = artifact_path(case, plan_path, "referenceAnalysis")
            retained_path = artifact_path(case, plan_path, "retainedTruth")
            review_dir = artifact_path(case, plan_path, "reviewPackDir")
            matches_path = artifact_path(case, plan_path, "matches")
            suite_path = artifact_path(case, plan_path, "suiteManifest")
            if any(path is None for path in (
                finish_path, reference_path, retained_path, review_dir, matches_path, suite_path
            )):
                raise ValueError("Population case is missing a required suite-build path.")
            if not finish_path.is_file() or not reference_path.is_file():
                raise ValueError("Finish media or reference analysis is missing.")
            if not retained_path.is_file() or not matches_path.is_file():
                raise ValueError("Retained truth or matcher observation is missing.")

            reference = load_json(reference_path)
            retained = load_json(retained_path)
            matches = load_json(matches_path)
            if matches.get("schema") != MATCH_SCHEMA:
                raise ValueError("Matcher observation schema is invalid.")
            source_paths = _case_source_paths(case, plan_path)
            source_hashes = {
                source_id: sha256_file(path)
                for source_id, path in source_paths.items()
            }
            finish_sha = sha256_file(finish_path)
            truth_errors = media_truth.validate_truth(
                retained,
                reference,
                allowed_source_ids=sorted(source_paths),
                allowed_source_sha256_by_id=source_hashes,
                require_retained=True,
            )
            if truth_errors:
                raise ValueError("Retained independent truth is invalid: " + " ".join(truth_errors))
            attestation_reasons = review_attestation_validation_reasons(
                review_dir,
                retained_truth_path=retained_path,
                expected_annotation_origin=retained.get("annotationOrigin"),
                expected_case_id=case_id,
                expected_finish_sha256=finish_sha,
                expected_source_sha256_by_id=source_hashes,
            )
            if attestation_reasons:
                raise ValueError(
                    "Suite build is blocked by stale independent review authority: "
                    + " ".join(attestation_reasons)
                )

            payload = media_truth.build_retained_suite_manifest(
                truth=retained,
                reference=reference,
                finish_path=str(finish_path),
                source_paths_by_id=source_paths,
                case_id=case_id,
                edit_type_id=str(plan["editTypeId"]).strip(),
                difficulty_tags=case.get("difficultyTags") or [],
                truth_evidence_sha256=sha256_file(retained_path),
                reference_evidence_sha256=sha256_file(reference_path),
                observation=matches,
                observation_evidence_sha256=sha256_file(matches_path),
            )
            write_json(suite_path, payload)
            suite = corpus.require_manifest(suite_path)
            if len(suite["cases"]) != 1:
                raise ValueError("Population suite manifest must contain exactly one case.")
            normalized = corpus.normalize_case(suite["cases"][0], suite_path)
            reasons = corpus.case_preflight_reasons(normalized)
            if reasons:
                suite_path.unlink(missing_ok=True)
                raise ValueError("Suite preflight failed: " + " ".join(reasons))
            results.append({
                "caseId": case_id,
                "status": "BUILT",
                "suiteManifest": str(suite_path),
            })
        except Exception as exc:
            results.append({"caseId": case_id, "status": "FAILED", "error": str(exc)})
    counts = Counter(item["status"] for item in results)
    return {
        "schema": SUITE_BUILD_SCHEMA,
        "editTypeId": str(plan["editTypeId"]).strip(),
        "builtCount": counts.get("BUILT", 0),
        "failedCount": counts.get("FAILED", 0),
        "cases": results,
    }


def advance_population(
    plan_path,
    annotation_origin=None,
    case_ids=None,
    source_atlas_interval_ms=DEFAULT_SOURCE_ATLAS_INTERVAL_MS,
    source_atlas_max_frames=DEFAULT_SOURCE_ATLAS_MAX_FRAMES,
    source_atlas_cache_dir=None,
    matcher_cache_dir=None,
    matcher_sample_step_ms=DEFAULT_MATCHER_SAMPLE_STEP_MS,
    matcher_analysis_fps=DEFAULT_MATCHER_ANALYSIS_FPS,
    matcher_coarse_limit=DEFAULT_MATCHER_COARSE_LIMIT,
    media_truth=None,
    matcher=None,
    corpus=None,
):
    plan = require_plan(plan_path)
    cases = selected_population_cases(plan, case_ids)
    media_truth = media_truth or load_media_truth_tool()
    matcher = matcher or load_media_match_tool()
    corpus = corpus or load_corpus_tool()
    results = []
    for case in cases:
        case_id = str(case.get("caseId", "")).strip() or "<missing-case-id>"
        operations = []
        outcome = "BLOCKED"
        error = None
        for _iteration in range(12):
            observed = inspect_case(case, plan_path, corpus)
            action = observed["nextAction"]
            if action == "NONE":
                outcome = "READY_FOR_CORPUS"
                break
            if action == "COMPLETE_INDEPENDENT_REVIEW":
                outcome = "WAITING_FOR_INDEPENDENT_REVIEW"
                break
            if action == "FINALIZE_INDEPENDENT_REVIEW":
                retained_path = artifact_path(case, plan_path, "retainedTruth")
                if retained_path is not None and retained_path.is_file():
                    outcome = "WAITING_FOR_REVIEW_RECHECK"
                    break
                if not annotation_origin:
                    outcome = "WAITING_FOR_ANNOTATION_ORIGIN"
                    break
                finalized = finalize_independent_reviews(
                    plan_path,
                    annotation_origin,
                    case_ids=[case_id],
                    media_truth=media_truth,
                )
                operations.append("FINALIZE_INDEPENDENT_REVIEW")
                if finalized["failedCount"]:
                    outcome = "FAILED"
                    error = finalized["cases"][0].get("error")
                    break
                continue
            if action in {"SCAFFOLD_TRUTH", "CREATE_REVIEW_PACK", "REBUILD_REVIEW_PACK"}:
                prepared = prepare_review_packs(
                    plan_path,
                    source_atlas_interval_ms=source_atlas_interval_ms,
                    source_atlas_max_frames=source_atlas_max_frames,
                    source_atlas_cache_dir=source_atlas_cache_dir,
                    case_ids=[case_id],
                    media_truth=media_truth,
                )
                operations.append(action)
                if prepared["failedCount"]:
                    outcome = "FAILED"
                    error = prepared["cases"][0].get("reason")
                    break
                continue
            if action == "REBUILD_TRUTH_SCAFFOLD":
                outcome = "WAITING_FOR_REVIEW_RESET"
                break
            if action in {"RUN_MATCHER_OBSERVATION", "RERUN_MATCHER_OBSERVATION"}:
                matched = run_matcher_observations(
                    plan_path,
                    case_ids=[case_id],
                    matcher=matcher,
                    media_truth=media_truth,
                    cache_dir=matcher_cache_dir,
                    sample_step_ms=matcher_sample_step_ms,
                    analysis_fps=matcher_analysis_fps,
                    coarse_limit=matcher_coarse_limit,
                )
                operations.append(action)
                if matched["failedCount"]:
                    outcome = "FAILED"
                    error = matched["cases"][0].get("error")
                    break
                continue
            if action in {"BUILD_SUITE_MANIFEST", "REBUILD_SUITE_MANIFEST"}:
                built = build_suite_manifests(
                    plan_path,
                    case_ids=[case_id],
                    media_truth=media_truth,
                    corpus=corpus,
                )
                operations.append(action)
                if built["failedCount"]:
                    outcome = "FAILED"
                    error = built["cases"][0].get("error")
                    break
                continue
            outcome = "BLOCKED"
            break
        final = inspect_case(case, plan_path, corpus)
        result = {
            "caseId": case_id,
            "outcome": outcome,
            "operations": operations,
            "finalStage": final["stage"],
            "nextAction": final["nextAction"],
            "readyForCorpus": bool(final["readyForCorpus"]),
            "reasons": list(final.get("reasons") or []),
        }
        if error:
            result["error"] = error
        results.append(result)

    counts = Counter(item["outcome"] for item in results)
    return {
        "schema": ADVANCE_SCHEMA,
        "editTypeId": str(plan["editTypeId"]).strip(),
        "readyForCorpusCount": counts.get("READY_FOR_CORPUS", 0),
        "waitingIndependentReviewCount": counts.get("WAITING_FOR_INDEPENDENT_REVIEW", 0),
        "waitingAnnotationOriginCount": counts.get("WAITING_FOR_ANNOTATION_ORIGIN", 0),
        "waitingReviewRecheckCount": counts.get("WAITING_FOR_REVIEW_RECHECK", 0),
        "failedCount": counts.get("FAILED", 0),
        "cases": results,
        "workQueue": build_work_queue(plan_path),
    }


def discover_finish_candidates(
    plan_path,
    finish_dirs,
    *,
    perceptual_screen=False,
    recursive=True,
    signature_provider=None,
):
    plan = require_plan(plan_path)
    scan_dirs = []
    for value in finish_dirs or []:
        directory = Path(value).expanduser().resolve()
        if not directory.is_dir():
            raise ValueError(f"Finish discovery directory does not exist: {directory}")
        scan_dirs.append(directory)
    if not scan_dirs:
        raise ValueError("At least one Finish discovery directory is required.")

    planned_by_sha = {}
    planned_signatures = []
    for case in plan["cases"]:
        finish = artifact_path(case, plan_path, "finishPath")
        if finish is None or not finish.is_file():
            continue
        case_id = str(case.get("caseId", "")).strip()
        finish_sha = sha256_file(finish)
        planned_by_sha.setdefault(finish_sha, case_id)
        if not perceptual_screen:
            continue
        signature = None
        reference_path = artifact_path(case, plan_path, "referenceAnalysis")
        if reference_path is not None and reference_path.is_file():
            try:
                reference = load_json(reference_path)
                if reference.get("schema") == REFERENCE_SCHEMA:
                    signature = reference.get("perceptualSignature")
            except (OSError, ValueError, json.JSONDecodeError):
                signature = None
        if not perceptual_signature_parts(signature):
            try:
                signature = finish_perceptual_signature(finish, signature_provider)
            except Exception:
                signature = None
        if perceptual_signature_parts(signature):
            planned_signatures.append({
                "caseId": case_id,
                "path": str(finish),
                "signature": signature,
            })

    media_paths = []
    seen_paths = set()
    for directory in scan_dirs:
        iterator = directory.rglob("*") if recursive else directory.iterdir()
        for path in sorted(iterator, key=lambda item: str(item).lower()):
            if not path.is_file() or path.suffix.lower() not in VIDEO_EXTENSIONS:
                continue
            resolved = path.resolve()
            key = str(resolved).lower()
            if key in seen_paths:
                continue
            seen_paths.add(key)
            media_paths.append(resolved)

    exact_unique = []
    duplicates = []
    discovered_by_sha = {}
    for path in media_paths:
        finish_sha = sha256_file(path)
        duplicate_case = planned_by_sha.get(finish_sha)
        duplicate_candidate = discovered_by_sha.get(finish_sha)
        if duplicate_case:
            duplicates.append({
                "path": str(path),
                "fileName": path.name,
                "sha256": finish_sha,
                "duplicateOfCaseId": duplicate_case,
                "duplicateOfCandidatePath": None,
            })
            continue
        if duplicate_candidate:
            duplicates.append({
                "path": str(path),
                "fileName": path.name,
                "sha256": finish_sha,
                "duplicateOfCaseId": None,
                "duplicateOfCandidatePath": duplicate_candidate,
            })
            continue
        discovered_by_sha[finish_sha] = str(path)
        exact_unique.append({
            "path": str(path),
            "fileName": path.name,
            "sha256": finish_sha,
            "bytes": path.stat().st_size,
            "requiresSourceBinding": True,
            "requiresReferenceAnalysis": True,
            "requiresPerceptualScreening": True,
        })

    unused = []
    perceptual_duplicates = []
    screening_failures = []
    accepted_signatures = []
    for candidate in exact_unique:
        if not perceptual_screen:
            unused.append(candidate)
            continue
        try:
            signature = finish_perceptual_signature(candidate["path"], signature_provider)
        except Exception as exc:
            failed = dict(candidate)
            failed["perceptualScreeningError"] = str(exc)
            screening_failures.append({
                "path": candidate["path"],
                "fileName": candidate["fileName"],
                "reason": str(exc),
            })
            unused.append(failed)
            continue
        if not perceptual_signature_parts(signature):
            failed = dict(candidate)
            failed["perceptualScreeningError"] = "Finish perceptual signature is unavailable or invalid."
            screening_failures.append({
                "path": candidate["path"],
                "fileName": candidate["fileName"],
                "reason": failed["perceptualScreeningError"],
            })
            unused.append(failed)
            continue

        duplicate = None
        for planned in planned_signatures:
            similarity = perceptual_similarity(signature, planned["signature"])
            if similarity is not None and similarity >= PERCEPTUAL_DUPLICATE_SIMILARITY:
                duplicate = {
                    "path": candidate["path"],
                    "fileName": candidate["fileName"],
                    "sha256": candidate["sha256"],
                    "similarity": similarity,
                    "duplicateOfCaseId": planned["caseId"],
                    "duplicateOfCandidatePath": None,
                }
                break
        if duplicate is None:
            for accepted in accepted_signatures:
                similarity = perceptual_similarity(signature, accepted["signature"])
                if similarity is not None and similarity >= PERCEPTUAL_DUPLICATE_SIMILARITY:
                    duplicate = {
                        "path": candidate["path"],
                        "fileName": candidate["fileName"],
                        "sha256": candidate["sha256"],
                        "similarity": similarity,
                        "duplicateOfCaseId": None,
                        "duplicateOfCandidatePath": accepted["path"],
                    }
                    break
        if duplicate is not None:
            perceptual_duplicates.append(duplicate)
            continue

        screened = dict(candidate)
        screened["requiresPerceptualScreening"] = False
        screened["perceptualSignature"] = signature
        unused.append(screened)
        accepted_signatures.append({"path": candidate["path"], "signature": signature})

    cases_needed = max(0, MIN_CASES - len(plan["cases"]))
    screened_unique_count = (
        sum(not item.get("requiresPerceptualScreening", True) for item in unused)
        if perceptual_screen else None
    )
    return {
        "schema": DISCOVERY_SCHEMA,
        "editTypeId": str(plan["editTypeId"]).strip(),
        "plannedCaseCount": len(plan["cases"]),
        "casesNeededForMinimum": cases_needed,
        "scanDirectories": [str(path) for path in scan_dirs],
        "scanRecursive": bool(recursive),
        "scannedVideoCount": len(media_paths),
        "exactUniqueUnusedFinishCount": len(exact_unique),
        "exactDuplicateFinishCount": len(duplicates),
        "canReachMinimumByExactUniqueFinishCount": len(exact_unique) >= cases_needed,
        "perceptualScreeningEnabled": bool(perceptual_screen),
        "perceptuallyUniqueUnusedFinishCount": screened_unique_count,
        "perceptualDuplicateFinishCount": len(perceptual_duplicates),
        "perceptualScreeningFailureCount": len(screening_failures),
        "canReachMinimumByScreenedUniqueFinishCount": (
            screened_unique_count >= cases_needed
            if screened_unique_count is not None else None
        ),
        "candidates": unused,
        "duplicates": duplicates,
        "perceptualDuplicates": perceptual_duplicates,
        "perceptualScreeningFailures": screening_failures,
    }


def build_parser():
    parser = argparse.ArgumentParser(
        description="Track population of the 20-30 case independent Practice truth suite."
    )
    sub = parser.add_subparsers(dest="command", required=True)
    status = sub.add_parser("status")
    status.add_argument("--manifest", required=True)
    status.add_argument("--output")
    work_queue = sub.add_parser("work-queue")
    work_queue.add_argument("--manifest", required=True)
    work_queue.add_argument(
        "--finish-discovery",
        help="Optional finish-discovery JSON used to expose source-binding admission gaps.",
    )
    work_queue.add_argument("--output")
    progression_gate = sub.add_parser("progression-gate")
    progression_gate.add_argument("--manifest", required=True)
    progression_gate.add_argument(
        "--finish-discovery",
        help="Optional finish-discovery JSON used to retain acquisition blockers in the gate report.",
    )
    progression_gate.add_argument("--output")
    acquisition_plan = sub.add_parser("acquisition-plan")
    acquisition_plan.add_argument("--manifest", required=True)
    acquisition_plan.add_argument(
        "--finish-discovery",
        required=True,
        help="Finish-discovery JSON used to schedule exact-bound case acquisition.",
    )
    acquisition_plan.add_argument(
        "--bindability",
        help="Optional bindability probe JSON; when supplied, only proven-bindable Finish candidates are scheduled.",
    )
    acquisition_plan.add_argument("--output")
    acquisition_probe = sub.add_parser("probe-acquisition-sources")
    acquisition_probe.add_argument("--manifest", required=True)
    acquisition_probe.add_argument("--finish-discovery", required=True)
    acquisition_probe.add_argument(
        "--source-video",
        action="append",
        required=True,
        help="Raw Start source in sourceId=path form; repeat to probe the available source pool.",
    )
    acquisition_probe.add_argument("--index-cache-dir")
    acquisition_probe.add_argument("--reference-cut-threshold", type=float, default=0.42)
    acquisition_probe.add_argument("--minimum-shot-ms", type=float, default=180.0)
    acquisition_probe.add_argument("--coarse-limit", type=int, default=16)
    acquisition_probe.add_argument("--minimum-coverage", type=float, default=0.98)
    acquisition_probe.add_argument("--output")
    acquisition_run = sub.add_parser("run-acquisition")
    acquisition_run.add_argument("--manifest", required=True)
    acquisition_run.add_argument("--finish-discovery", required=True)
    acquisition_run.add_argument("--output-plan", required=True)
    acquisition_run.add_argument(
        "--source-video",
        action="append",
        required=True,
        help="Raw Start source in sourceId=path form; repeat to build the acquisition source pool.",
    )
    acquisition_run.add_argument(
        "--difficulty",
        action="append",
        help="Verified case difficulty in caseId=TAG[,TAG] form; repeat as needed.",
    )
    acquisition_run.add_argument(
        "--case-id",
        action="append",
        help="Run only this planned acquisition case id; repeat to select multiple cases.",
    )
    acquisition_run.add_argument("--bindability")
    acquisition_run.add_argument("--index-cache-dir")
    acquisition_run.add_argument("--reference-cut-threshold", type=float, default=0.42)
    acquisition_run.add_argument("--minimum-shot-ms", type=float, default=180.0)
    acquisition_run.add_argument("--coarse-limit", type=int, default=16)
    acquisition_run.add_argument("--minimum-coverage", type=float, default=0.98)
    acquisition_run.add_argument("--output")
    advance = sub.add_parser("advance")
    advance.add_argument("--manifest", required=True)
    advance.add_argument(
        "--annotation-origin",
        choices=sorted(ALLOWED_ANNOTATION_ORIGINS),
        help="Required only when a completed independent worksheet is ready to retain.",
    )
    advance.add_argument(
        "--case-id",
        action="append",
        help="Advance only this population case id; repeat to select multiple cases.",
    )
    advance.add_argument(
        "--source-atlas-interval-ms",
        type=float,
        default=DEFAULT_SOURCE_ATLAS_INTERVAL_MS,
    )
    advance.add_argument(
        "--source-atlas-max-frames",
        type=int,
        default=DEFAULT_SOURCE_ATLAS_MAX_FRAMES,
    )
    advance.add_argument("--source-atlas-cache-dir")
    advance.add_argument("--matcher-cache-dir")
    advance.add_argument(
        "--matcher-sample-step-ms",
        type=float,
        default=DEFAULT_MATCHER_SAMPLE_STEP_MS,
    )
    advance.add_argument(
        "--matcher-analysis-fps",
        type=float,
        default=DEFAULT_MATCHER_ANALYSIS_FPS,
    )
    advance.add_argument(
        "--matcher-coarse-limit",
        type=int,
        default=DEFAULT_MATCHER_COARSE_LIMIT,
    )
    advance.add_argument("--output")
    prepare = sub.add_parser("prepare-review-packs")
    prepare.add_argument("--manifest", required=True)
    prepare.add_argument(
        "--source-atlas-interval-ms",
        type=float,
        default=DEFAULT_SOURCE_ATLAS_INTERVAL_MS,
    )
    prepare.add_argument(
        "--source-atlas-max-frames",
        type=int,
        default=DEFAULT_SOURCE_ATLAS_MAX_FRAMES,
    )
    prepare.add_argument(
        "--source-atlas-cache-dir",
        help="Optional shared content-addressed cache for Start thumbnails.",
    )
    prepare.add_argument(
        "--case-id",
        action="append",
        help="Prepare only this population case id; repeat to select multiple cases.",
    )
    prepare.add_argument("--force", action="store_true")
    prepare.add_argument("--output")
    finalize = sub.add_parser("finalize-independent-review")
    finalize.add_argument("--manifest", required=True)
    finalize.add_argument(
        "--annotation-origin",
        required=True,
        choices=sorted(ALLOWED_ANNOTATION_ORIGINS),
    )
    finalize.add_argument(
        "--case-id",
        action="append",
        help="Finalize only this reviewed population case id; repeat to select multiple cases.",
    )
    finalize.add_argument(
        "--force",
        action="store_true",
        help="Replace retained truth only after rechecking the independent worksheet.",
    )
    finalize.add_argument("--output")
    discover = sub.add_parser("discover-finish-candidates")
    discover.add_argument("--manifest", required=True)
    discover.add_argument(
        "--finish-dir",
        action="append",
        required=True,
        help="Directory containing candidate professional Finish videos; repeat as needed.",
    )
    discover.add_argument(
        "--no-recursive-scan",
        action="store_true",
        help="Scan only the direct children of each Finish directory.",
    )
    discover.add_argument(
        "--skip-perceptual-screen",
        action="store_true",
        help="Skip near-duplicate Finish screening; production discovery screens by default.",
    )
    discover.add_argument("--output")
    admit = sub.add_parser("admit-bound-case")
    admit.add_argument("--manifest", required=True)
    admit.add_argument("--case-id", required=True)
    admit.add_argument("--finish", required=True)
    admit.add_argument("--source-binding", required=True)
    admit.add_argument(
        "--source-video",
        action="append",
        required=True,
        help="Raw Start source in sourceId=path form; repeat as needed.",
    )
    admit.add_argument(
        "--difficulty-tag",
        action="append",
        required=True,
        choices=sorted(ALLOWED_DIFFICULTIES),
    )
    admit.add_argument(
        "--case-dir",
        help="Artifact directory for the admitted case; defaults to a case-id-derived folder.",
    )
    admit.add_argument(
        "--output",
        required=True,
        help="Updated population-plan JSON path.",
    )
    return parser


def main():
    args = build_parser().parse_args()
    exit_code = 0
    if args.command == "status":
        payload = build_status(args.manifest)
    elif args.command == "work-queue":
        payload = build_work_queue(
            args.manifest,
            finish_discovery_path=args.finish_discovery,
        )
    elif args.command == "progression-gate":
        payload = build_progression_gate(
            args.manifest,
            finish_discovery_path=args.finish_discovery,
        )
        if not payload["retainedEvaluationAllowed"]:
            exit_code = 3
    elif args.command == "acquisition-plan":
        payload = build_acquisition_plan(
            args.manifest,
            args.finish_discovery,
            bindability_path=args.bindability,
        )
        if not payload["acquisitionReady"]:
            exit_code = 4
    elif args.command == "probe-acquisition-sources":
        payload = probe_acquisition_bindability(
            args.manifest,
            args.finish_discovery,
            args.source_video,
            cut_threshold=args.reference_cut_threshold,
            minimum_shot_ms=args.minimum_shot_ms,
            coarse_limit=args.coarse_limit,
            minimum_coverage=args.minimum_coverage,
            index_cache_dir=args.index_cache_dir,
        )
        if not payload["canMeetMinimumByBindableCandidateCount"]:
            exit_code = 4
    elif args.command == "run-acquisition":
        payload = execute_acquisition_plan(
            args.manifest,
            args.finish_discovery,
            args.output_plan,
            args.source_video,
            difficulty_specs=args.difficulty,
            case_ids=args.case_id,
            bindability_path=args.bindability,
            cut_threshold=args.reference_cut_threshold,
            minimum_shot_ms=args.minimum_shot_ms,
            coarse_limit=args.coarse_limit,
            minimum_coverage=args.minimum_coverage,
            index_cache_dir=args.index_cache_dir,
        )
        if payload["blockedCount"] or not payload["acquisitionReady"]:
            exit_code = 5
    elif args.command == "advance":
        payload = advance_population(
            args.manifest,
            annotation_origin=args.annotation_origin,
            case_ids=args.case_id,
            source_atlas_interval_ms=args.source_atlas_interval_ms,
            source_atlas_max_frames=args.source_atlas_max_frames,
            source_atlas_cache_dir=args.source_atlas_cache_dir,
            matcher_cache_dir=args.matcher_cache_dir,
            matcher_sample_step_ms=args.matcher_sample_step_ms,
            matcher_analysis_fps=args.matcher_analysis_fps,
            matcher_coarse_limit=args.matcher_coarse_limit,
        )
        if payload["failedCount"]:
            exit_code = 2
    elif args.command == "prepare-review-packs":
        payload = prepare_review_packs(
            args.manifest,
            source_atlas_interval_ms=args.source_atlas_interval_ms,
            source_atlas_max_frames=args.source_atlas_max_frames,
            source_atlas_cache_dir=args.source_atlas_cache_dir,
            force=args.force,
            case_ids=args.case_id,
        )
    elif args.command == "finalize-independent-review":
        payload = finalize_independent_reviews(
            args.manifest,
            args.annotation_origin,
            case_ids=args.case_id,
            force=args.force,
        )
        if payload["failedCount"]:
            exit_code = 2
    elif args.command == "admit-bound-case":
        result = admit_bound_case(
            args.manifest,
            args.case_id,
            args.finish,
            args.source_binding,
            args.source_video,
            args.difficulty_tag,
            case_dir=args.case_dir,
        )
        target = Path(args.output)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(
            json.dumps(result["plan"], indent=2) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        payload = result["admission"]
    else:
        payload = discover_finish_candidates(
            args.manifest,
            args.finish_dir,
            perceptual_screen=not args.skip_perceptual_screen,
            recursive=not args.no_recursive_scan,
        )
    if args.command != "admit-bound-case" and args.output:
        target = Path(args.output)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(payload, indent=2))
    if exit_code:
        raise SystemExit(exit_code)


if __name__ == "__main__":
    main()
