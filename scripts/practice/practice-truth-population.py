#!/usr/bin/env python3
import argparse
import csv
import hashlib
import importlib.util
import json
import math
from collections import Counter
from pathlib import Path

POPULATION_SCHEMA = "editflow.practice-truth-population-plan.v1"
STATUS_SCHEMA = "editflow.practice-truth-population-status.v1"
REFERENCE_SCHEMA = "editflow.practice-reference-analysis.v1"
TRUTH_SCHEMA = "editflow.practice-media-benchmark-truth.v1"
MATCH_SCHEMA = "editflow.practice-scene-matches.v1"
REVIEW_PACK_SCHEMA = "editflow.practice-truth-review-pack.v1"
RETAINED_SUITE_SCHEMA = "editflow.practice-retained-truth-suite-manifest.v1"
REQUIRED_REVIEW_FIELDS = ("sourceId", "sourceStartMs", "sourceEndMs", "direction")
ALLOWED_DIRECTIONS = {"FORWARD", "REVERSE"}
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
DISCOVERY_SCHEMA = "editflow.practice-truth-finish-discovery.v1"
VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".m4v", ".webm"}
DEFAULT_SOURCE_ATLAS_INTERVAL_MS = 300000.0
DEFAULT_SOURCE_ATLAS_MAX_FRAMES = 30


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


def artifact_path(case, manifest_path, key):
    return resolve_path(manifest_path, case.get(key))


def current_source_media_identity(case, manifest_path, media_truth=None):
    media_truth = media_truth or load_media_truth_tool()
    source_paths = _case_source_paths(case, manifest_path)
    cached_hasher = getattr(media_truth, "sha256_file_cached", sha256_file)
    source_hashes = {
        source_id: cached_hasher(source_path)
        for source_id, source_path in source_paths.items()
    }
    return source_paths, source_hashes


def retained_truth_validation_reasons(
    case,
    manifest_path,
    reference,
    retained,
    media_truth=None,
    source_hashes=None,
):
    media_truth = media_truth or load_media_truth_tool()
    if source_hashes is None:
        _source_paths, source_hashes = current_source_media_identity(
            case,
            manifest_path,
            media_truth=media_truth,
        )
    return media_truth.validate_truth(
        retained,
        reference,
        allowed_source_ids=source_ids(case),
        allowed_source_sha256_by_id=source_hashes,
        require_retained=True,
    )


def source_binding_validation_reasons(
    case,
    manifest_path,
    reference,
    matches,
    source_hashes=None,
    source_binding=None,
):
    source_binding = source_binding or load_source_binding_tool()
    if source_hashes is None:
        _source_paths, source_hashes = current_source_media_identity(case, manifest_path)
    result = source_binding.evaluate_binding(reference, matches)
    reasons = list(result.get("reasons") or [])
    if result.get("status") != "BOUND":
        for rejected in result.get("rejectedShots") or []:
            shot_id = str(rejected.get("shotId", "")).strip() or "<unknown-shot>"
            for reason in rejected.get("reasons") or []:
                reasons.append(f"{shot_id}: {reason}")

    if str(result.get("referenceId", "")).strip() != str(reference.get("referenceId", "")).strip():
        reasons.append("Source binding reference identity does not match current Finish analysis.")
    for binding in result.get("sourceBindings") or []:
        source_id = str(binding.get("sourceId", "")).strip()
        source_sha = str(binding.get("sourceSha256", "")).strip().lower()
        expected_sha = str(source_hashes.get(source_id, "")).strip().lower()
        if not expected_sha:
            reasons.append(f"Source binding uses undeclared Start source id: {source_id or '<missing>'}.")
        elif source_sha != expected_sha:
            reasons.append(
                f"Source binding SHA-256 for {source_id} does not match current Start media bytes."
            )
    return list(dict.fromkeys(str(reason) for reason in reasons if str(reason).strip()))


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
        return case_result(case_id, tags, "TRUTH_RETENTION", "IMPORT_AND_RETAIN_TRUTH")

    retained = load_json(retained_path)
    if retained.get("schema") != TRUTH_SCHEMA or retained.get("status") != "RETAINED":
        return case_result(case_id, tags, "TRUTH_RETENTION", "RETAIN_TRUTH",
                           ["Retained truth artifact is invalid or not retained."])
    try:
        media_truth = load_media_truth_tool()
        _source_paths, current_source_hashes = current_source_media_identity(
            case,
            manifest_path,
            media_truth=media_truth,
        )
        truth_reasons = retained_truth_validation_reasons(
            case,
            manifest_path,
            reference,
            retained,
            media_truth=media_truth,
            source_hashes=current_source_hashes,
        )
    except Exception as exc:
        return case_result(
            case_id,
            tags,
            "TRUTH_RETENTION",
            "REBUILD_RETAINED_TRUTH",
            ["Retained truth could not be revalidated: " + str(exc)],
        )
    if truth_reasons:
        return case_result(
            case_id,
            tags,
            "TRUTH_RETENTION",
            "REBUILD_RETAINED_TRUTH",
            ["Retained truth validation: " + reason for reason in truth_reasons],
        )

    matches_path = artifact_path(case, manifest_path, "matches")
    if matches_path is None or not matches_path.is_file():
        return case_result(case_id, tags, "MATCHER_OBSERVATION", "RUN_MATCHER_OBSERVATION")

    matches = load_json(matches_path)
    if matches.get("schema") != MATCH_SCHEMA:
        return case_result(case_id, tags, "MATCHER_OBSERVATION", "RERUN_MATCHER_OBSERVATION",
                           ["Matcher observation schema is invalid."])
    try:
        binding_reasons = source_binding_validation_reasons(
            case,
            manifest_path,
            reference,
            matches,
            source_hashes=current_source_hashes,
        )
    except Exception as exc:
        return case_result(
            case_id,
            tags,
            "MATCHER_OBSERVATION",
            "IMPROVE_SOURCE_BINDING",
            ["Source binding could not be evaluated: " + str(exc)],
        )
    if binding_reasons:
        return case_result(
            case_id,
            tags,
            "MATCHER_OBSERVATION",
            "IMPROVE_SOURCE_BINDING",
            ["Source binding validation: " + reason for reason in binding_reasons],
        )

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
            results.append({
                "caseId": case_id,
                "status": "PREPARED",
                "reviewPack": str(review_dir / "review-pack.json"),
                "truthScaffoldCreated": scaffold_created,
                "sourceAtlasCount": len(manifest.get("sourceAtlas") or []),
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
    return parser


def main():
    args = build_parser().parse_args()
    if args.command == "status":
        payload = build_status(args.manifest)
    elif args.command == "prepare-review-packs":
        payload = prepare_review_packs(
            args.manifest,
            source_atlas_interval_ms=args.source_atlas_interval_ms,
            source_atlas_max_frames=args.source_atlas_max_frames,
            source_atlas_cache_dir=args.source_atlas_cache_dir,
            force=args.force,
            case_ids=args.case_id,
        )
    else:
        payload = discover_finish_candidates(
            args.manifest,
            args.finish_dir,
            perceptual_screen=not args.skip_perceptual_screen,
            recursive=not args.no_recursive_scan,
        )
    if args.output:
        target = Path(args.output)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
