#!/usr/bin/env python3
import argparse
import hashlib
import importlib.util
import json
import math
import re
from pathlib import Path

BINDING_SCHEMA = "editflow.practice-source-binding.v1"
SOURCE_SHA_PREFIX = "source-video:sha256:"
DEFAULT_MINIMUM_COVERAGE = 0.98
DEFAULT_MINIMUM_CONFIDENCE = 0.95
DEFAULT_MINIMUM_MARGIN = 0.02
DEFAULT_MINIMUM_STRONG_ANCHORS = 2


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def write_json(path, payload):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(payload, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_stem(value):
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", str(value).strip()).strip("-._")
    return stem or "source"


def parse_source_video(value):
    source_id, separator, media_path = str(value).partition("=")
    if not separator or not source_id.strip() or not media_path.strip():
        raise ValueError("--source-video must use sourceId=path syntax.")
    path = Path(media_path).expanduser().resolve()
    if not path.is_file():
        raise ValueError("Start source media does not exist: " + str(path))
    return source_id.strip(), path


def unique_nonempty(values):
    return list(dict.fromkeys(
        str(value).strip()
        for value in values or []
        if str(value).strip()
    ))


def finite_number(value):
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(float(value))
    )


def reference_duration_ms(reference):
    duration = (reference.get("video") or {}).get("durationMs")
    if not finite_number(duration) or float(duration) <= 0:
        raise ValueError("Reference analysis is missing a positive video.durationMs.")
    return float(duration)


def timeline_coverage(reference, shot_ids):
    duration = reference_duration_ms(reference)
    selected = set(shot_ids)
    ranges = []
    for shot in reference.get("shots") or []:
        if str(shot.get("shotId", "")).strip() not in selected:
            continue
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


def retained_source_sha(match):
    values = unique_nonempty(
        ref[len(SOURCE_SHA_PREFIX):].lower()
        for ref in match.get("evidenceRefs") or []
        if str(ref).startswith(SOURCE_SHA_PREFIX)
    )
    if len(values) != 1:
        return None
    value = values[0]
    if len(value) != 64 or any(ch not in "0123456789abcdef" for ch in value):
        return None
    return value


def match_qualification_reasons(
    match,
    minimum_confidence=DEFAULT_MINIMUM_CONFIDENCE,
    minimum_margin=DEFAULT_MINIMUM_MARGIN,
    minimum_strong_anchors=DEFAULT_MINIMUM_STRONG_ANCHORS,
):
    reasons = []
    confidence = match.get("confidence")
    if not finite_number(confidence) or float(confidence) < minimum_confidence:
        reasons.append("confidence below exact-scene binding gate")
    margin = match.get("candidateMargin")
    if not finite_number(margin) or float(margin) < minimum_margin:
        reasons.append("candidate margin is ambiguous")
    proof = match.get("geometricProof") or {}
    strong_anchors = proof.get("strongAnchorCount")
    if not finite_number(strong_anchors) or int(strong_anchors) < minimum_strong_anchors:
        reasons.append("repeated geometric proof is insufficient")
    if retained_source_sha(match) is None:
        reasons.append("exactly one retained source SHA-256 identity is required")

    start = match.get("sourceStartMs")
    end = match.get("sourceEndMs")
    if not finite_number(start) or not finite_number(end) or float(end) <= float(start):
        reasons.append("source time range is invalid")
    if not str(match.get("sourceId", "")).strip():
        reasons.append("source id is missing")
    return reasons


def evaluate_binding(
    reference,
    observation,
    minimum_coverage=DEFAULT_MINIMUM_COVERAGE,
    minimum_confidence=DEFAULT_MINIMUM_CONFIDENCE,
    minimum_margin=DEFAULT_MINIMUM_MARGIN,
    minimum_strong_anchors=DEFAULT_MINIMUM_STRONG_ANCHORS,
):
    shots = list(reference.get("shots") or [])
    if not shots:
        raise ValueError("Reference analysis contains no shots.")
    grouped = {}
    for match in observation.get("matches") or []:
        shot_id = str(match.get("shotId", "")).strip()
        if shot_id:
            grouped.setdefault(shot_id, []).append(match)


    qualified = []
    rejected = []
    for shot in shots:
        shot_id = str(shot.get("shotId", "")).strip()
        values = grouped.get(shot_id, [])
        if len(values) != 1:
            rejected.append({
                "shotId": shot_id,
                "reasons": [
                    "expected exactly one retained scene match; found "
                    + str(len(values))
                ],
            })
            continue
        match = values[0]
        reasons = match_qualification_reasons(
            match,
            minimum_confidence=minimum_confidence,
            minimum_margin=minimum_margin,
            minimum_strong_anchors=minimum_strong_anchors,
        )
        if reasons:
            rejected.append({"shotId": shot_id, "reasons": reasons})
            continue
        qualified.append(match)

    coverage = timeline_coverage(
        reference,
        [str(match.get("shotId", "")).strip() for match in qualified],
    )

    source_identities = {}
    identity_reasons = []
    for match in qualified:
        source_id = str(match.get("sourceId", "")).strip()
        source_sha = retained_source_sha(match)
        existing = source_identities.get(source_id)
        if existing is not None and existing != source_sha:
            identity_reasons.append(
                "source id " + source_id + " maps to multiple retained SHA-256 identities"
            )
        source_identities[source_id] = source_sha

    reasons = list(identity_reasons)
    if coverage < minimum_coverage:
        reasons.append(
            "qualified exact-scene coverage "
            + f"{coverage:.6f} is below required {minimum_coverage:.6f}"
        )
    if not source_identities:
        reasons.append("no exact-scene-qualified Start source identity was retained")

    status = "BOUND" if not reasons else "NO_VALID_BINDING"
    bindings = [
        {"sourceId": source_id, "sourceSha256": source_sha}
        for source_id, source_sha in sorted(source_identities.items())
    ]

    return {
        "schema": BINDING_SCHEMA,
        "status": status,
        "referenceId": str(reference.get("referenceId", "")).strip(),
        "minimumCoverage": float(minimum_coverage),
        "minimumConfidence": float(minimum_confidence),
        "minimumCandidateMargin": float(minimum_margin),
        "minimumStrongAnchors": int(minimum_strong_anchors),
        "totalShotCount": len(shots),
        "qualifiedShotCount": len(qualified),
        "qualifiedTimelineCoverage": coverage,
        "sourceBindings": bindings,
        "rejectedShots": rejected,
        "reasons": unique_nonempty(reasons),
        "evidenceRefs": unique_nonempty(
            ref
            for match in qualified
            for ref in match.get("evidenceRefs") or []
        ),
    }


def load_matcher():
    script = Path(__file__).with_name("practice-media-match.py")
    spec = importlib.util.spec_from_file_location("practice_media_match", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def ensure_source_index(source_id, source_path, cache_dir, matcher=None):
    matcher = matcher or load_matcher()
    source_path = Path(source_path).resolve()
    source_sha = sha256_file(source_path)
    cache_dir = Path(cache_dir).resolve()
    cache_dir.mkdir(parents=True, exist_ok=True)
    artifact_path = cache_dir / (
        safe_stem(source_id) + "-" + source_sha[:20] + ".json"
    )
    if artifact_path.is_file():
        artifact = load_json(artifact_path)
        if (
            artifact.get("schema") == "editflow.practice-source-index.v1"
            and artifact.get("sourceId") == source_id
            and str(artifact.get("sourceSha256", "")).lower() == source_sha
        ):
            return str(artifact_path)

    matcher.index_source(
        str(source_path),
        source_id,
        str(artifact_path),
        250.0,
        proxy_dir=str(cache_dir / "proxies"),
        analysis_fps=matcher.DEFAULT_ANALYSIS_PROXY_FPS,
    )
    artifact = load_json(artifact_path)
    if (
        artifact.get("schema") != "editflow.practice-source-index.v1"
        or artifact.get("sourceId") != source_id
        or str(artifact.get("sourceSha256", "")).lower() != source_sha
    ):
        raise ValueError("Practice source index does not match requested Start media.")
    return str(artifact_path)


def bind_sources(
    reference_path,
    output_path,
    source_index_paths=None,
    source_video_specs=None,
    index_cache_dir=None,
    matches_path=None,
    matches_output=None,
    coarse_limit=16,
    minimum_coverage=DEFAULT_MINIMUM_COVERAGE,
):
    reference = load_json(reference_path)
    if matches_path:
        observation = load_json(matches_path)
        retained_matches_path = str(Path(matches_path).resolve())
    else:
        matcher = load_matcher()
        effective_index_paths = list(source_index_paths or [])
        if source_video_specs:
            cache_dir = (
                Path(index_cache_dir).resolve()
                if index_cache_dir
                else Path(output_path).resolve().parent / ".source-index-cache"
            )
            for spec in source_video_specs:
                source_id, source_path = parse_source_video(spec)
                effective_index_paths.append(
                    ensure_source_index(
                        source_id,
                        source_path,
                        cache_dir,
                        matcher=matcher,
                    )
                )
        if not effective_index_paths:
            raise ValueError(
                "Source binding requires --matches-json, --source-index-json, "
                "or --source-video."
            )
        retained_matches_path = str(
            Path(matches_output or (str(output_path) + ".matches.json")).resolve()
        )
        observation = matcher.match_reference(
            reference_path,
            effective_index_paths,
            retained_matches_path,
            coarse_limit,
        )
        source_index_paths = effective_index_paths

    result = evaluate_binding(
        reference,
        observation,
        minimum_coverage=minimum_coverage,
    )
    result["referencePath"] = str(Path(reference_path).resolve())
    result["matchesPath"] = retained_matches_path
    result["sourceIndexPaths"] = [
        str(Path(path).resolve()) for path in source_index_paths or []
    ]
    write_json(output_path, result)
    return result


def build_parser():
    parser = argparse.ArgumentParser(
        description=(
            "Certify a Practice Finish-to-Start source binding from exact-scene "
            "matcher evidence."
        )
    )
    parser.add_argument("--reference-json", required=True)
    parser.add_argument("--source-index-json", action="append")
    parser.add_argument(
        "--source-video",
        action="append",
        help="Raw Start source in sourceId=path form; may be repeated.",
    )
    parser.add_argument("--index-cache-dir")
    parser.add_argument("--matches-json")
    parser.add_argument("--matches-output")
    parser.add_argument("--output", required=True)
    parser.add_argument("--coarse-limit", type=int, default=16)
    parser.add_argument(
        "--minimum-coverage",
        type=float,
        default=DEFAULT_MINIMUM_COVERAGE,
    )
    return parser


def main():
    args = build_parser().parse_args()
    if args.matches_json and (args.source_index_json or args.source_video):
        raise ValueError(
            "Use --matches-json by itself, or provide Start sources/indexes."
        )
    if args.coarse_limit < 2 or args.coarse_limit > 64:
        raise ValueError("--coarse-limit must be in [2, 64].")
    if not (0.5 <= args.minimum_coverage <= 1.0):
        raise ValueError("--minimum-coverage must be in [0.5, 1.0].")

    result = bind_sources(
        args.reference_json,
        args.output,
        source_index_paths=args.source_index_json,
        source_video_specs=args.source_video,
        index_cache_dir=args.index_cache_dir,
        matches_path=args.matches_json,
        matches_output=args.matches_output,
        coarse_limit=args.coarse_limit,
        minimum_coverage=args.minimum_coverage,
    )
    print(json.dumps({
        "ok": True,
        "status": result["status"],
        "qualifiedTimelineCoverage": result["qualifiedTimelineCoverage"],
        "sourceBindings": result["sourceBindings"],
        "output": str(Path(args.output).resolve()),
    }))


if __name__ == "__main__":
    main()
