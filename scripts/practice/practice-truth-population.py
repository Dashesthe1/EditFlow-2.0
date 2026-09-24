#!/usr/bin/env python3
import argparse
import csv
import hashlib
import importlib.util
import json
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
PERCEPTUAL_DUPLICATE_SIMILARITY = 0.96
PREPARE_SCHEMA = "editflow.practice-truth-review-preparation.v1"
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


def worksheet_complete(path):
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
            float(str(row["sourceStartMs"]).strip())
            float(str(row["sourceEndMs"]).strip())
        except ValueError:
            return False
    return True


def review_pack_has_source_atlas(review_dir, expected_source_ids):
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
    for source_id in expected_source_ids:
        samples = by_source[source_id].get("samples")
        if not isinstance(samples, list) or not samples:
            return False
        for sample in samples:
            preview = sample.get("previewPath") if isinstance(sample, dict) else None
            if not preview or not (review_dir / str(preview)).is_file():
                return False
    return True


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
        if not worksheet_complete(worksheet):
            return case_result(case_id, tags, "INDEPENDENT_REVIEW", "COMPLETE_INDEPENDENT_REVIEW")
        return case_result(case_id, tags, "TRUTH_RETENTION", "IMPORT_AND_RETAIN_TRUTH")

    retained = load_json(retained_path)
    if retained.get("schema") != TRUTH_SCHEMA or retained.get("status") != "RETAINED":
        return case_result(case_id, tags, "TRUTH_RETENTION", "RETAIN_TRUTH",
                           ["Retained truth artifact is invalid or not retained."])
    if retained.get("annotationOrigin") not in {"INDEPENDENT_HUMAN", "INDEPENDENT_EXTERNAL_TOOL"}:
        return case_result(case_id, tags, "TRUTH_RETENTION", "RETAIN_TRUTH",
                           ["Retained truth does not have an independent annotation origin."])

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
    force=False,
    media_truth=None,
):
    plan = require_plan(plan_path)
    media_truth = media_truth or load_media_truth_tool()
    interval_ms = float(source_atlas_interval_ms)
    max_frames = int(source_atlas_max_frames)
    if interval_ms < 0.0:
        raise ValueError("Source-atlas interval cannot be negative.")
    if max_frames < 1:
        raise ValueError("Source-atlas max frame count must be at least 1.")

    results = []
    for case in plan["cases"]:
        case_id = str(case.get("caseId", "")).strip() or "<missing-case-id>"
        review_dir = artifact_path(case, plan_path, "reviewPackDir")
        expected_source_ids = source_ids(case)
        needs_atlas = interval_ms > 0.0
        if review_dir is None:
            results.append({"caseId": case_id, "status": "FAILED", "reason": "reviewPackDir is missing."})
            continue
        if not force and (review_dir / "review-pack.json").is_file():
            if not needs_atlas or review_pack_has_source_atlas(review_dir, expected_source_ids):
                results.append({"caseId": case_id, "status": "SKIPPED", "reason": "Review pack already satisfies requested preparation."})
                continue
        try:
            finish_path = artifact_path(case, plan_path, "finishPath")
            reference_path = artifact_path(case, plan_path, "referenceAnalysis")
            draft_path = artifact_path(case, plan_path, "truthDraft")
            if finish_path is None or not finish_path.is_file():
                raise ValueError("Finish media is missing.")
            if reference_path is None or not reference_path.is_file():
                raise ValueError("Reference analysis is missing.")
            if draft_path is None or not draft_path.is_file():
                raise ValueError("Truth draft is missing.")
            manifest = media_truth.build_review_pack(
                reference=load_json(reference_path),
                draft=load_json(draft_path),
                finish_path=str(finish_path),
                source_paths_by_id=_case_source_paths(case, plan_path),
                output_dir=review_dir,
                source_atlas_interval_ms=(interval_ms if needs_atlas else None),
                source_atlas_max_frames=max_frames,
            )
            results.append({
                "caseId": case_id,
                "status": "PREPARED",
                "reviewPack": str(review_dir / "review-pack.json"),
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
        "cases": results,
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
    prepare.add_argument("--force", action="store_true")
    prepare.add_argument("--output")
    return parser


def main():
    args = build_parser().parse_args()
    if args.command == "status":
        payload = build_status(args.manifest)
    else:
        payload = prepare_review_packs(
            args.manifest,
            source_atlas_interval_ms=args.source_atlas_interval_ms,
            source_atlas_max_frames=args.source_atlas_max_frames,
            force=args.force,
        )
    if args.output:
        target = Path(args.output)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
