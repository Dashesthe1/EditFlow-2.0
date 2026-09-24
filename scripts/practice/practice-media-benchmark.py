#!/usr/bin/env python3
import argparse
import hashlib
import importlib.util
import json
import math
import os
import re
from pathlib import Path

SUITE_SCHEMA = "editflow.practice-media-benchmark-suite.v1"
TRUTH_SCHEMA = "editflow.practice-media-benchmark-truth.v1"
REPORT_SCHEMA = "editflow.practice-media-benchmark-report.v1"
DEFAULT_CONFIDENCE = 0.95
MIN_CERTIFIED_CASES = 20
MIN_DISTINCT_CERTIFIED_REFERENCES = 20
RECOMMENDED_MAX_CERTIFICATION_CASES = 30


def clamp01(value):
    return max(0.0, min(1.0, float(value)))


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def write_json(path, payload):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, indent=2), encoding="utf-8", newline="\n")
def resolve_path(base_dir, value):
    expanded = os.path.expandvars(os.path.expanduser(str(value)))
    path = Path(expanded)
    if not path.is_absolute():
        path = Path(base_dir) / path
    return path.resolve()


def safe_name(value):
    return re.sub(r"[^A-Za-z0-9._-]+", "-", str(value)).strip("-") or "case"


def cached_media_sha256(matcher, media_path, cache=None):
    media_path = Path(media_path).resolve()
    if cache is None:
        return matcher.sha256_file(media_path)
    stat_before = media_path.stat()
    key = str(media_path)
    retained = cache.get(key)
    if retained is not None:
        if (
            int(retained["size"]) != int(stat_before.st_size)
            or int(retained["mtimeNs"]) != int(stat_before.st_mtime_ns)
        ):
            raise RuntimeError(
                "Practice benchmark media changed during the suite: " + key
            )
        return str(retained["sha256"])
    digest = matcher.sha256_file(media_path)
    stat_after = media_path.stat()
    if (
        int(stat_after.st_size) != int(stat_before.st_size)
        or int(stat_after.st_mtime_ns) != int(stat_before.st_mtime_ns)
    ):
        raise RuntimeError(
            "Practice benchmark media changed while SHA-256 was being computed: " + key
        )
    cache[key] = {
        "size": int(stat_after.st_size),
        "mtimeNs": int(stat_after.st_mtime_ns),
        "sha256": str(digest),
    }
    return str(digest)


def shared_source_cache_paths(
    output_root,
    source_video,
    source_id,
    source_sha256,
    sample_step_ms,
    analysis_fps,
):
    identity = json.dumps({
        "sourcePath": str(Path(source_video).resolve()),
        "sourceId": str(source_id),
        "sourceSha256": str(source_sha256).lower(),
        "sampleStepMs": float(sample_step_ms),
        "analysisFps": float(analysis_fps),
    }, sort_keys=True, separators=(",", ":"))
    cache_id = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]
    shared_root = Path(output_root) / "_shared"
    index_path = (
        shared_root
        / "source-indexes"
        / f"{safe_name(source_id)}-{cache_id}.json"
    )
    proxy_dir = shared_root / "proxy" / cache_id
    return index_path, proxy_dir


def exact_geometry(match):
    proof = (match or {}).get("geometricProof") or {}
    return (
        int(proof.get("strongAnchorCount", 0)) >= 2
        and float(proof.get("strongAnchorFraction", 0.0)) >= 0.30
        and float(proof.get("meanSupport", 0.0)) >= 0.45
        and int(proof.get("maximumInlierCount", 0)) >= 6
    )


def interval_metrics(match, truth):
    actual_start = float(match.get("sourceStartMs", 0.0))
    actual_end = float(match.get("sourceEndMs", 0.0))
    truth_start = float(truth["sourceStartMs"])
    truth_end = float(truth["sourceEndMs"])
    actual_low, actual_high = sorted((actual_start, actual_end))
    truth_low, truth_high = sorted((truth_start, truth_end))
    overlap = max(0.0, min(actual_high, truth_high) - max(actual_low, truth_low))
    union = max(actual_high, truth_high) - min(actual_low, truth_low)
    iou = overlap / union if union > 1e-9 else 1.0
    center_error = abs(
        ((actual_low + actual_high) / 2.0)
        - ((truth_low + truth_high) / 2.0)
    )
    boundary_error = max(
        abs(actual_low - truth_low),
        abs(actual_high - truth_high),
    )
    truth_duration = max(1.0, truth_high - truth_low)
    default_tolerance = max(300.0, min(1000.0, truth_duration * 0.35))
    tolerance = float(truth.get("toleranceMs", default_tolerance))
    correct = boundary_error <= tolerance and iou >= float(truth.get("minimumIou", 0.50))
    return {
        "intervalIou": clamp01(iou),
        "centerErrorMs": center_error,
        "maximumBoundaryErrorMs": boundary_error,
        "toleranceMs": tolerance,
        "correct": bool(correct),
    }
def mean(values):
    return float(sum(values) / len(values)) if values else 0.0


def evaluate_case(case, reference, matches_payload, truth_payload=None):
    reference_shots = list(reference.get("shots") or [])
    reference_ids = [str(item["shotId"]) for item in reference_shots]
    matches = list(matches_payload.get("matches") or [])
    matches_by_shot = {str(item["shotId"]): item for item in matches}
    truth_shots = list((truth_payload or {}).get("shots") or [])
    truth_by_shot = {str(item["shotId"]): item for item in truth_shots}
    confidence_gate = float(case.get("minimumConfidence", DEFAULT_CONFIDENCE))

    per_shot = []
    false_high_confidence = 0
    for shot_id in reference_ids:
        match = matches_by_shot.get(shot_id)
        truth = truth_by_shot.get(shot_id)
        if truth is None:
            per_shot.append({
                "shotId": shot_id,
                "truthAvailable": False,
                "matched": match is not None,
                "confidence": float((match or {}).get("confidence", 0.0)),
                "certified": False,
            })
            continue
        timing = interval_metrics(match or {}, truth) if match is not None else {
            "intervalIou": 0.0,
            "centerErrorMs": math.inf,
            "maximumBoundaryErrorMs": math.inf,
            "toleranceMs": float(truth.get("toleranceMs", 0.0)),
            "correct": False,
        }
        source_correct = (
            match is not None
            and str(match.get("sourceId")) == str(truth["sourceId"])
        )
        expected_direction = truth.get("direction")
        direction_correct = (
            match is not None
            and (
                expected_direction is None
                or str(match.get("direction")) == str(expected_direction)
            )
        )
        geometry_correct = match is not None and exact_geometry(match)
        confidence = float((match or {}).get("confidence", 0.0))
        truth_correct = source_correct and timing["correct"] and direction_correct
        false_high_confidence_claim = confidence >= confidence_gate and not truth_correct
        if false_high_confidence_claim:
            false_high_confidence += 1
        failure_kinds = []
        if match is None:
            failure_kinds.append("NO_MATCH")
        else:
            if not source_correct:
                failure_kinds.append("SOURCE_IDENTITY_MISMATCH")
            if not timing["correct"]:
                failure_kinds.append("TIMING_MISMATCH")
            if not direction_correct:
                failure_kinds.append("DIRECTION_MISMATCH")
            if not geometry_correct:
                failure_kinds.append("GEOMETRY_PROOF_INSUFFICIENT")
            if confidence < confidence_gate:
                failure_kinds.append("CONFIDENCE_BELOW_GATE")
        per_shot.append({
            "shotId": shot_id,
            "truthAvailable": True,
            "matched": match is not None,
            "sourceIdentityCorrect": bool(source_correct),
            "directionCorrect": bool(direction_correct),
            "geometricProofCorrect": bool(geometry_correct),
            "confidence": confidence,
            "retainedConfidence": confidence >= confidence_gate,
            "falseHighConfidence": false_high_confidence_claim,
            "failureKinds": failure_kinds,
            "expected": {
                "sourceId": str(truth["sourceId"]),
                "sourceStartMs": float(truth["sourceStartMs"]),
                "sourceEndMs": float(truth["sourceEndMs"]),
                "direction": truth.get("direction"),
            },
            "observed": ({
                "sourceId": str(match.get("sourceId")),
                "sourceStartMs": float(match.get("sourceStartMs", 0.0)),
                "sourceEndMs": float(match.get("sourceEndMs", 0.0)),
                "direction": match.get("direction"),
            } if match is not None else None),
            **timing,
            "certified": bool(
                truth_correct
                and geometry_correct
                and confidence >= confidence_gate
            ),
        })

    truth_rows = [item for item in per_shot if item["truthAvailable"]]
    direction_rows = [
        item for item in truth_rows
        if truth_by_shot[item["shotId"]].get("direction") is not None
    ]
    shot_count = len(reference_ids)
    metrics = {
        "referenceShotCount": shot_count,
        "matchedShotCount": sum(1 for item in per_shot if item["matched"]),
        "coverageRate": mean([1.0 if item["matched"] else 0.0 for item in per_shot]),
        "truthShotCount": len(truth_rows),
        "truthCoverageRate": (len(truth_rows) / shot_count) if shot_count else 0.0,
        "sourceIdentityAccuracy": mean([
            1.0 if item["sourceIdentityCorrect"] else 0.0 for item in truth_rows
        ]),
        "timingAccuracy": mean([1.0 if item["correct"] else 0.0 for item in truth_rows]),
        "directionAccuracy": mean([
            1.0 if item["directionCorrect"] else 0.0 for item in direction_rows
        ]) if direction_rows else 1.0,
        "geometricProofRate": mean([
            1.0 if item["geometricProofCorrect"] else 0.0 for item in truth_rows
        ]),
        "retainedConfidenceRate": mean([
            1.0 if item["retainedConfidence"] else 0.0 for item in truth_rows
        ]),
        "meanConfidence": mean([item["confidence"] for item in per_shot]),
        "meanIntervalIou": mean([item["intervalIou"] for item in truth_rows]),
        "meanCenterErrorMs": mean([
            item["centerErrorMs"] for item in truth_rows if math.isfinite(item["centerErrorMs"])
        ]),
        "falseHighConfidenceCount": false_high_confidence,
    }

    reasons = []
    complete_truth = shot_count > 0 and metrics["truthCoverageRate"] >= 1.0
    if not complete_truth:
        reasons.append("Retained shot-level truth does not cover the full reference.")
    gates = {
        "minimumCoverageRate": float(case.get("minimumCoverageRate", 1.0)),
        "minimumSourceIdentityAccuracy": float(case.get("minimumSourceIdentityAccuracy", 1.0)),
        "minimumTimingAccuracy": float(case.get("minimumTimingAccuracy", 0.95)),
        "minimumDirectionAccuracy": float(case.get("minimumDirectionAccuracy", 1.0)),
        "minimumGeometricProofRate": float(case.get("minimumGeometricProofRate", 1.0)),
        "minimumRetainedConfidenceRate": float(case.get("minimumRetainedConfidenceRate", 1.0)),
        "maximumFalseHighConfidenceCount": int(case.get("maximumFalseHighConfidenceCount", 0)),
    }
    checks = [
        ("coverageRate", metrics["coverageRate"], gates["minimumCoverageRate"]),
        ("sourceIdentityAccuracy", metrics["sourceIdentityAccuracy"], gates["minimumSourceIdentityAccuracy"]),
        ("timingAccuracy", metrics["timingAccuracy"], gates["minimumTimingAccuracy"]),
        ("directionAccuracy", metrics["directionAccuracy"], gates["minimumDirectionAccuracy"]),
        ("geometricProofRate", metrics["geometricProofRate"], gates["minimumGeometricProofRate"]),
        ("retainedConfidenceRate", metrics["retainedConfidenceRate"], gates["minimumRetainedConfidenceRate"]),
    ]
    for name, observed, required in checks:
        if complete_truth and observed + 1e-12 < required:
            reasons.append(f"{name} {observed:.4f} is below required {required:.4f}.")
    if complete_truth and false_high_confidence > gates["maximumFalseHighConfidenceCount"]:
        reasons.append(
            "falseHighConfidenceCount "
            f"{false_high_confidence} exceeds allowed {gates['maximumFalseHighConfidenceCount']}."
        )

    if not complete_truth:
        status = "MEASURE_ONLY"
    else:
        status = "PASS" if not reasons else "FAIL"
    failure_diagnostics = [{
        "shotId": item["shotId"],
        "failureKinds": list(item.get("failureKinds") or []),
        "falseHighConfidence": bool(item.get("falseHighConfidence", False)),
        "confidence": float(item.get("confidence", 0.0)),
        "confidenceGate": confidence_gate,
        "geometricProofCorrect": bool(item.get("geometricProofCorrect", False)),
        "intervalIou": float(item.get("intervalIou", 0.0)),
        "centerErrorMs": item.get("centerErrorMs"),
        "maximumBoundaryErrorMs": item.get("maximumBoundaryErrorMs"),
        "expected": item.get("expected"),
        "observed": item.get("observed"),
    } for item in per_shot if item.get("truthAvailable") and not item.get("certified")]
    return {
        "benchmarkId": str(case["benchmarkId"]),
        "referenceId": str(reference.get("referenceId", case.get("referenceId", ""))),
        "referenceSourceSha256": str(reference.get("sourceSha256", "")),
        "status": status,
        "metrics": metrics,
        "gates": gates,
        "reasons": reasons,
        "failureDiagnostics": failure_diagnostics,
        "falseMatchDiagnostics": [
            item for item in failure_diagnostics if item["falseHighConfidence"]
        ],
        "perShot": per_shot,
    }
def load_matcher():
    script = Path(__file__).with_name("practice-media-match.py")
    spec = importlib.util.spec_from_file_location("editflow_practice_media_match", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load matcher from {script}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_truth_tool():
    script = Path(__file__).with_name("practice-media-truth.py")
    spec = importlib.util.spec_from_file_location("editflow_practice_media_truth", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load truth tool from {script}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def cached_artifact(matcher, path, schema):
    path = Path(path)
    if not path.is_file():
        return None
    try:
        return matcher.load_artifact(path, schema)
    except Exception:
        return None


def same_number(left, right, tolerance=1e-9):
    try:
        return abs(float(left) - float(right)) <= tolerance
    except (TypeError, ValueError):
        return False


def reference_cache_compatible(
    artifact,
    reference_video,
    reference_id,
    cut_threshold,
    minimum_shot_ms,
    analysis_fps,
    source_sha256=None,
):
    analysis = artifact.get("analysis") or {}
    return (
        str(artifact.get("referenceId")) == str(reference_id)
        and Path(str(artifact.get("sourcePath", ""))).resolve() == Path(reference_video).resolve()
        and (source_sha256 is None or str(artifact.get("sourceSha256")) == str(source_sha256))
        and same_number(analysis.get("cutThreshold"), cut_threshold)
        and same_number(analysis.get("minimumShotMs"), minimum_shot_ms)
        and analysis.get("analysisProxyMode") == "FFMPEG_MJPEG_CFR_V1"
        and same_number(analysis.get("analysisProxyFps"), analysis_fps)
    )


def source_cache_compatible(
    artifact,
    source_video,
    source_id,
    sample_step_ms,
    analysis_fps,
    source_sha256=None,
):
    analysis = artifact.get("analysis") or {}
    return (
        str(artifact.get("sourceId")) == str(source_id)
        and Path(str(artifact.get("sourcePath", ""))).resolve() == Path(source_video).resolve()
        and (source_sha256 is None or str(artifact.get("sourceSha256")) == str(source_sha256))
        and same_number(analysis.get("sampleStepMs"), sample_step_ms)
        and same_number(analysis.get("analysisProxyFps"), analysis_fps)
    )


def run_case(matcher, case, base_dir, output_root, media_sha256_cache=None):
    benchmark_id = str(case["benchmarkId"])
    case_dir = Path(output_root) / safe_name(benchmark_id)
    case_dir.mkdir(parents=True, exist_ok=True)
    reference_video = resolve_path(base_dir, case["referenceVideo"])
    reference_json = case_dir / "reference-analysis.json"
    reference_id = str(case.get("referenceId", benchmark_id))
    cut_threshold = float(case.get("cutThreshold", 0.42))
    minimum_shot_ms = float(case.get("minimumShotMs", 180.0))
    reference_analysis_fps = float(case.get("referenceAnalysisFps", 12.0))
    reference_sha256 = cached_media_sha256(
        matcher, reference_video, media_sha256_cache
    )
    reference = cached_artifact(
        matcher,
        reference_json,
        "editflow.practice-reference-analysis.v1",
    )
    if reference is None or not reference_cache_compatible(
        reference,
        reference_video,
        reference_id,
        cut_threshold,
        minimum_shot_ms,
        reference_analysis_fps,
        reference_sha256,
    ):
        matcher.analyze_reference(
            reference_video,
            reference_id,
            reference_json,
            cut_threshold,
            minimum_shot_ms,
            explicit_ffmpeg=case.get("ffmpeg"),
            proxy_dir=case_dir / "reference-proxy",
            analysis_fps=reference_analysis_fps,
            source_sha256=reference_sha256,
        )
        reference = matcher.load_artifact(
            reference_json,
            "editflow.practice-reference-analysis.v1",
        )

    source_descriptors = []
    seen_source_ids = set()
    for source in case.get("sources") or []:
        source_id = str(source["sourceId"]).strip()
        if not source_id:
            raise ValueError(f"{benchmark_id}: sourceId must not be blank.")
        if source_id in seen_source_ids:
            raise ValueError(f"{benchmark_id}: duplicate sourceId {source_id}.")
        seen_source_ids.add(source_id)
        source_video = resolve_path(base_dir, source["video"])
        source_sha256 = cached_media_sha256(
            matcher, source_video, media_sha256_cache
        )
        source_descriptors.append((source, source_id, source_video, source_sha256))
    if not source_descriptors:
        raise ValueError(f"{benchmark_id}: at least one Start source is required.")

    allowed_source_ids = [item[1] for item in source_descriptors]
    allowed_source_sha256_by_id = {
        item[1]: item[3]
        for item in source_descriptors
    }

    truth_payload = None
    if case.get("truthFile"):
        truth_path = resolve_path(base_dir, case["truthFile"])
        truth_payload = load_json(truth_path)
        truth_tool = load_truth_tool()
        truth_errors = truth_tool.validate_truth(
            truth_payload,
            reference,
            allowed_source_ids=allowed_source_ids,
            allowed_source_sha256_by_id=allowed_source_sha256_by_id,
            require_retained=True,
        )
        if truth_errors:
            raise ValueError(
                f"{truth_path} is not retained independent benchmark truth:\n- "
                + "\n- ".join(truth_errors)
            )

    source_indexes = []
    for source, source_id, source_video, source_sha256 in source_descriptors:
        sample_step_ms = float(source.get("sampleStepMs", case.get("sampleStepMs", 500.0)))
        analysis_fps = float(source.get("analysisFps", case.get("analysisFps", 6.0)))
        source_json, proxy_dir = shared_source_cache_paths(
            output_root,
            source_video,
            source_id,
            source_sha256,
            sample_step_ms,
            analysis_fps,
        )
        source_json.parent.mkdir(parents=True, exist_ok=True)
        proxy_dir.mkdir(parents=True, exist_ok=True)
        source_index = cached_artifact(
            matcher,
            source_json,
            "editflow.practice-source-index.v1",
        )
        if source_index is None or not source_cache_compatible(
            source_index,
            source_video,
            source_id,
            sample_step_ms,
            analysis_fps,
            source_sha256,
        ):
            matcher.index_source(
                source_video,
                source_id,
                source_json,
                sample_step_ms,
                explicit_ffmpeg=case.get("ffmpeg"),
                proxy_dir=proxy_dir,
                analysis_fps=analysis_fps,
                source_sha256=source_sha256,
            )
        source_indexes.append(source_json)

    matches_json = case_dir / "scene-matches.json"
    matches_payload = matcher.match_reference(
        reference_json,
        source_indexes,
        matches_json,
        int(case.get("coarseLimit", 16)),
    )
    result = evaluate_case(case, reference, matches_payload, truth_payload)
    result["artifacts"] = {
        "referenceAnalysis": str(reference_json),
        "sceneMatches": str(matches_json),
        "sourceIndexes": [str(item) for item in source_indexes],
        **(
            {"truth": str(resolve_path(base_dir, case["truthFile"]))}
            if case.get("truthFile")
            else {}
        ),
    }
    write_json(case_dir / "benchmark-result.json", result)
    return result


def summarize_suite(results):
    results = list(results or [])
    case_count = len(results)
    pass_count = sum(1 for item in results if item.get("status") == "PASS")
    fail_count = sum(1 for item in results if item.get("status") == "FAIL")
    measure_only_count = sum(
        1 for item in results if item.get("status") == "MEASURE_ONLY"
    )
    benchmark_ids = [
        str(item.get("benchmarkId", "")).strip()
        for item in results
    ]
    reference_ids = [
        str(item.get("referenceId", "")).strip()
        for item in results
    ]
    reference_sha256 = [
        str(item.get("referenceSourceSha256", "")).strip().lower()
        for item in results
    ]
    distinct_benchmark_ids = sorted({item for item in benchmark_ids if item})
    distinct_reference_ids = sorted({item for item in reference_ids if item})
    distinct_reference_sha256 = sorted({item for item in reference_sha256 if item})
    failure_diagnostics = []
    for result in results:
        for diagnostic in result.get("failureDiagnostics") or []:
            failure_diagnostics.append({
                "benchmarkId": str(result.get("benchmarkId", "")),
                "referenceId": str(result.get("referenceId", "")),
                **diagnostic,
            })
    failure_kind_counts = {}
    for diagnostic in failure_diagnostics:
        for kind in diagnostic.get("failureKinds") or []:
            failure_kind_counts[kind] = failure_kind_counts.get(kind, 0) + 1
    false_match_diagnostics = [
        item for item in failure_diagnostics if item.get("falseHighConfidence")
    ]

    reasons = []
    if case_count < MIN_CERTIFIED_CASES:
        reasons.append(
            f"caseCount {case_count} is below the generalization floor "
            f"of {MIN_CERTIFIED_CASES}."
        )
    if len(distinct_reference_ids) < MIN_DISTINCT_CERTIFIED_REFERENCES:
        reasons.append(
            "distinctReferenceCount "
            f"{len(distinct_reference_ids)} is below the generalization floor "
            f"of {MIN_DISTINCT_CERTIFIED_REFERENCES}."
        )
    if len(distinct_reference_sha256) < MIN_DISTINCT_CERTIFIED_REFERENCES:
        reasons.append(
            "distinctReferenceSha256Count "
            f"{len(distinct_reference_sha256)} is below the generalization floor "
            f"of {MIN_DISTINCT_CERTIFIED_REFERENCES}."
        )
    if len(distinct_benchmark_ids) != case_count:
        reasons.append("Benchmark IDs must be unique across the certification suite.")
    if fail_count:
        reasons.append(f"{fail_count} benchmark case(s) failed retained truth gates.")
    if measure_only_count:
        reasons.append(
            f"{measure_only_count} benchmark case(s) are MEASURE_ONLY and cannot certify."
        )
    if pass_count != case_count:
        reasons.append("Every certification case must finish with PASS status.")

    certified = bool(results) and not reasons
    return {
        "caseCount": case_count,
        "passCount": pass_count,
        "failCount": fail_count,
        "measureOnlyCount": measure_only_count,
        "certified": certified,
        "diagnostics": {
            "failedShotCount": len(failure_diagnostics),
            "falseHighConfidenceCount": len(false_match_diagnostics),
            "failureKindCounts": dict(sorted(failure_kind_counts.items())),
            "falseMatchDiagnostics": false_match_diagnostics,
        },
        "generalizationGate": {
            "minimumCaseCount": MIN_CERTIFIED_CASES,
            "recommendedMaximumCaseCount": RECOMMENDED_MAX_CERTIFICATION_CASES,
            "minimumDistinctReferenceCount": MIN_DISTINCT_CERTIFIED_REFERENCES,
            "minimumDistinctReferenceSha256Count": MIN_DISTINCT_CERTIFIED_REFERENCES,
            "distinctBenchmarkCount": len(distinct_benchmark_ids),
            "distinctReferenceCount": len(distinct_reference_ids),
            "distinctReferenceSha256Count": len(distinct_reference_sha256),
            "reasons": reasons,
        },
    }


def run_suite(manifest_path, output_root):
    manifest_path = Path(manifest_path).resolve()
    suite = load_json(manifest_path)
    if suite.get("schema") != SUITE_SCHEMA:
        raise ValueError(f"Benchmark manifest must use {SUITE_SCHEMA}")
    cases = list(suite.get("cases") or [])
    if not cases:
        raise ValueError("Benchmark manifest must contain at least one case.")
    matcher = load_matcher()
    starting_fingerprint = matcher.analyzer_fingerprint()
    media_sha256_cache = {}
    results = []
    for case in cases:
        if matcher.analyzer_fingerprint() != starting_fingerprint:
            raise RuntimeError(
                "Practice matcher changed during the benchmark; restart from stable code."
            )
        results.append(run_case(
            matcher,
            case,
            manifest_path.parent,
            output_root,
            media_sha256_cache=media_sha256_cache,
        ))
        if matcher.analyzer_fingerprint() != starting_fingerprint:
            raise RuntimeError(
                "Practice matcher changed during the benchmark; retained artifacts are invalid."
            )
    summary = summarize_suite(results)
    return {
        "schema": REPORT_SCHEMA,
        "suiteId": str(suite.get("suiteId", manifest_path.stem)),
        "matcherAlgorithmId": matcher.ALGORITHM_ID,
        "matcherAnalyzerFingerprint": matcher.analyzer_fingerprint(),
        "summary": summary,
        "cases": results,
    }


def build_parser():
    parser = argparse.ArgumentParser(
        description="Run truth-retained Practice media benchmarks against long-form sources."
    )
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--report", required=True)
    return parser
def main():
    args = build_parser().parse_args()
    report = run_suite(args.manifest, args.output_dir)
    write_json(args.report, report)
    print(json.dumps({
        "ok": True,
        "report": str(Path(args.report).resolve()),
        "summary": report["summary"],
    }))
    if report["summary"]["failCount"] > 0:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
