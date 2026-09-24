#!/usr/bin/env python3
import argparse
import csv
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

def build_parser():
    parser = argparse.ArgumentParser(
        description="Track population of the 20-30 case independent Practice truth suite."
    )
    sub = parser.add_subparsers(dest="command", required=True)
    status = sub.add_parser("status")
    status.add_argument("--manifest", required=True)
    status.add_argument("--output")
    return parser


def main():
    args = build_parser().parse_args()
    payload = build_status(args.manifest)
    if args.output:
        target = Path(args.output)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
