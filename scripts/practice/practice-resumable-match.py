#!/usr/bin/env python3
"""Durable shot orchestration around the unchanged, fingerprinted analysis engine."""
import argparse
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("practice_media_core", Path(__file__).with_name("practice-media-match.py"))
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)
globals().update({key: value for key, value in vars(core).items() if not key.startswith("__")})

def match_reference(
    reference_path,
    source_index_paths,
    output_path,
    coarse_limit,
    correction_profile_path=None,
    correction_case_id=None,
    shot_ids=None,
    checkpoint_path=None,
    seed_matches_path=None,
):
    correction_profile = load_matcher_correction_profile(correction_profile_path)
    if correction_profile is not None and (correction_case_id is None or not str(correction_case_id).strip()):
        raise ValueError("Practice matcher correction replay requires --correction-case-id.")
    reference = load_artifact(reference_path, "editflow.practice-reference-analysis.v1")
    source_indexes = [
        load_artifact(path, "editflow.practice-source-index.v1")
        for path in source_index_paths
    ]
    for source_index in source_indexes:
        source_index["_times"] = [float(sample["timeMs"]) for sample in source_index["samples"]]

    reference_reader = FrameReader(reference["sourcePath"])
    source_readers = {
        source_index["sourceId"]: FrameReader(
            source_index.get("analysisProxyPath") or source_index["sourcePath"]
        )
        for source_index in source_indexes
    }
    requested = None if not shot_ids else set(shot_ids)
    known_shots = {shot["shotId"] for shot in reference["shots"]}
    if requested is not None and not requested.issubset(known_shots):
        raise ValueError("Targeted refinement contains unknown reference shots.")
    identity = hashlib.sha256(json.dumps({
        "reference": hashlib.sha256(Path(reference_path).read_bytes()).hexdigest(),
        "sources": [hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in source_index_paths],
        "coarseLimit": coarse_limit, "shots": sorted(requested or []),
        "analyzer": analyzer_fingerprint(), "correctionCase": correction_case_id,
        "orchestrator": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "correction": correction_profile,
    }, sort_keys=True).encode()).hexdigest()
    retained = {}
    attempted = set()
    if seed_matches_path:
        seed = load_artifact(seed_matches_path, "editflow.practice-scene-matches.v1")
        if seed.get("referenceId") != reference["referenceId"]:
            raise ValueError("Seed matches belong to another reference.")
        retained = {m["shotId"]: m for m in seed["matches"] if m["shotId"] in known_shots}
    if checkpoint_path and Path(checkpoint_path).exists():
        checkpoint = json.loads(Path(checkpoint_path).read_text(encoding="utf-8"))
        if checkpoint.get("inputIdentity") == identity:
            retained.update({m["shotId"]: m for m in checkpoint["matches"]})
            attempted = set(checkpoint.get("attemptedShotIds", []))
    matches = []
    def save_checkpoint():
        if checkpoint_path is None:
            return
        checkpoint = {"inputIdentity": identity, "matches": matches,
                      "attemptedShotIds": sorted(attempted)}
        temporary = Path(str(checkpoint_path) + ".tmp-" + str(os.getpid()))
        temporary.parent.mkdir(parents=True, exist_ok=True)
        temporary.write_text(json.dumps(checkpoint), encoding="utf-8")
        os.replace(temporary, checkpoint_path)
    try:
        for shot_index, shot in enumerate(reference["shots"]):
            if shot["shotId"] in attempted or (requested is not None and shot["shotId"] not in requested):
                if shot["shotId"] in retained:
                    matches.append(retained[shot["shotId"]])
                continue
            correction_applied = matcher_correction_applies(
                correction_profile,
                correction_case_id,
                shot["shotId"],
            )
            detailed_per_source_limit = (
                int(correction_profile["detailedPerSourceLimit"])
                if correction_applied else (4 if requested is not None else 2)
            )
            detailed_global_limit = (
                int(correction_profile["detailedGlobalLimit"])
                if correction_applied else (8 if requested is not None else 4)
            )
            continuity_maximum_bonus = (
                float(correction_profile["continuityMaximumBonus"])
                if correction_applied else 0.06
            )
            previous_shot = reference["shots"][shot_index - 1] if shot_index > 0 else None
            previous_match = (
                matches[-1]
                if previous_shot is not None
                and matches
                and matches[-1]["shotId"] == previous_shot["shotId"]
                else None
            )
            boundary = (
                reference_boundary_continuity(reference_reader, previous_shot, shot)
                if previous_shot is not None
                else None
            )
            continuity_bonus = (
                min(source_continuity_bonus(boundary), continuity_maximum_bonus)
                if scene_identity_verified(previous_match)
                else 0.0
            )

            coarse = coarse_candidates_for_shot(shot, source_indexes, coarse_limit)
            refined = []
            for candidate in coarse:
                reader = source_readers[candidate["index"]["sourceId"]]
                mapping = refine_candidate(shot, candidate, reference_reader, reader)
                if mapping is None:
                    continue
                refined.append({
                    "candidate": candidate,
                    "index": candidate["index"],
                    "sample": candidate["sample"],
                    "coarseScore": candidate["score"],
                    "mapping": mapping,
                })
            refined.sort(key=lambda item: item["mapping"]["score"], reverse=True)
            if not refined:
                attempted.add(shot["shotId"])
                save_checkpoint()
                continue

            # Retain multiple timing hypotheses per source before local refinement.
            # The retained truth suite explicitly separates WRONG_SOURCE from
            # SOURCE_RANGE_MISMATCH; keeping only one seed per source can turn a
            # recoverable timing ambiguity into a false source/timing claim.
            detailed_seeds = source_stratified_candidates(
                refined,
                per_source_limit=detailed_per_source_limit,
                global_limit=detailed_global_limit,
            )

            detailed = []
            for item in detailed_seeds:
                reader = source_readers[item["index"]["sourceId"]]
                mapping = refine_candidate(
                    shot,
                    item["candidate"],
                    reference_reader,
                    reader,
                    local_refine=True,
                )
                if mapping is None:
                    continue
                detailed.append({**item, "mapping": mapping})
            continuity_source_id = (
                previous_match["sourceId"]
                if previous_match is not None and continuity_bonus > 0.0
                else None
            )
            if continuity_source_id is not None:
                continuity_index = next(
                    (
                        item
                        for item in source_indexes
                        if item["sourceId"] == continuity_source_id
                    ),
                    None,
                )
                if continuity_index is not None:
                    continuity_reader = source_readers[continuity_source_id]
                    continuity_items = continuity_candidates(
                        shot,
                        continuity_index,
                        reference_reader,
                        continuity_reader,
                    )
                    existing_keys = {
                        (
                            item["index"]["sourceId"],
                            float(item["sample"]["timeMs"]),
                        )
                        for item in detailed
                    }
                    for item in continuity_items:
                        key = (
                            item["index"]["sourceId"],
                            float(item["sample"]["timeMs"]),
                        )
                        if key in existing_keys:
                            continue
                        detailed.append(item)
                        existing_keys.add(key)

            if not detailed:
                continue

            # Give the best two timing hypotheses from every source a geometric
            # screen, then keep a few global leaders. This prevents repeated
            # scenery or near-duplicate sources from winning merely because the
            # correct within-source timing hypothesis was pruned before geometry.
            geometry_candidates = source_stratified_candidates(
                detailed,
                per_source_limit=detailed_per_source_limit,
                global_limit=detailed_global_limit,
            )

            for item in geometry_candidates:
                reader = source_readers[item["index"]["sourceId"]]
                item["mapping"] = {
                    **item["mapping"],
                    "geometricProof": mapping_geometric_proof(
                        shot,
                        item["mapping"],
                        reference_reader,
                        reader,
                        max_anchors=3,
                    ),
                }

            repeated_geometry_present = any(
                int(item["mapping"].get("geometricProof", {}).get("strongAnchorCount", 0)) >= 2
                and float(item["mapping"].get("geometricProof", {}).get("meanSupport", 0.0)) >= 0.75
                for item in detailed
            )
            if not repeated_geometry_present:
                for source_index in source_indexes:
                    source_id = source_index["sourceId"]
                    reader = source_readers[source_id]
                    rescue_mapping = geometric_rescue_candidate(
                        shot,
                        source_index,
                        reference_reader,
                        reader,
                    )
                    if rescue_mapping is None:
                        continue
                    rescue_sample = nearest_sample(
                        source_index,
                        float(rescue_mapping["centerSourceMs"]),
                    )
                    if rescue_sample is None:
                        continue
                    detailed.append({
                        "candidate": {
                            "score": float(rescue_mapping["rescueScore"]),
                            "sample": rescue_sample,
                            "index": source_index,
                        },
                        "index": source_index,
                        "sample": rescue_sample,
                        "coarseScore": float(rescue_mapping["rescueScore"]),
                        "mapping": rescue_mapping,
                    })

            refined = finalize_candidate_geometry(
                shot,
                detailed,
                reference_reader,
                source_readers,
                continuity_source_id,
                continuity_bonus,
            )
            best = max(
                refined,
                key=lambda item: candidate_selection_score(
                    item,
                    continuity_source_id,
                    continuity_bonus,
                ),
            )
            mapping = best["mapping"]
            second = distinct_second_result(refined, best)
            second_score = (
                0.0
                if second is None
                else candidate_rank_score(second["mapping"])
            )
            collision_risk = ambiguous_geometric_collision(best, second)
            center_reference = shot["anchors"][len(shot["anchors"]) // 2]["timeMs"]
            mapped_start = mapping["centerSourceMs"] + mapping["slope"] * (
                shot["referenceStartMs"] - center_reference
            )
            mapped_end = mapping["centerSourceMs"] + mapping["slope"] * (
                shot["referenceEndMs"] - center_reference
            )
            source_duration = float(best["index"]["video"]["durationMs"])
            trajectory = mapping.get("trajectory") or []
            trajectory_source_times = [float(item["sourceTimeMs"]) for item in trajectory]
            source_start = min([mapped_start, mapped_end, *trajectory_source_times])
            source_end = max([mapped_start, mapped_end, *trajectory_source_times])
            source_start = max(0.0, source_start)
            source_end = min(source_duration, source_end)
            confidence = confidence_from_result(best, second_score)
            if collision_risk:
                confidence = min(confidence, 0.949)
            temporal_behavior = mapping.get("temporalBehavior") or (
                "FORWARD" if mapping["slope"] >= 0 else "REVERSE"
            )
            rewind = mapping.get("rewind")
            continuity_applied = (
                continuity_source_id is not None
                and continuity_bonus > 0.0
                and best["index"]["sourceId"] == continuity_source_id
            )
            candidate_score = candidate_rank_score(mapping)
            candidate_margin = candidate_score - float(second_score)
            selection_mode = (
                "GEOMETRIC_RESCUE"
                if mapping.get("rescueScore") is not None
                else (
                    "REFERENCE_CONTINUITY_PRIOR"
                    if continuity_applied
                    else "VISUAL_BEST"
                )
            )
            boundary_evidence = (
                [
                    f"practice-reference-boundary-continuity:{boundary['score']:.6f}",
                    f"practice-reference-boundary-descriptor:{boundary['descriptor']:.6f}",
                    f"practice-reference-boundary-feature:{boundary['feature']:.6f}",
                ]
                if boundary is not None
                else []
            )
            matches.append({
                "shotId": shot["shotId"],
                "sourceId": best["index"]["sourceId"],
                "sourcePath": best["index"]["sourcePath"],
                "sourceStartMs": float(source_start),
                "sourceEndMs": float(source_end),
                "direction": "FORWARD" if mapping["slope"] >= 0 else "REVERSE",
                "playbackRate": float(abs(mapping["slope"])),
                "trajectory": trajectory,
                "temporalBehavior": temporal_behavior,
                **({"rewind": rewind} if rewind is not None else {}),
                "appearanceSimilarity": float(mapping["appearance"]),
                "temporalSimilarity": float(mapping["consistency"]),
                "motionSimilarity": float(mapping["minimum"]),
                "geometricProof": mapping.get("geometricProof", {}),
                "confidence": confidence,
                "candidateScore": float(candidate_score),
                "runnerUpScore": float(second_score),
                "candidateMargin": float(candidate_margin),
                **(
                    {"referenceBoundaryContinuity": float(boundary["score"])}
                    if boundary is not None else {}
                ),
                "selectionMode": selection_mode,
                "evidenceRefs": [
                    f"reference-shot:{shot['shotId']}",
                    f"source-video:sha256:{best['index']['sourceSha256']}",
                    f"practice-analyzer:sha256:{analyzer_fingerprint()}",
                    f"coarse-score:{best['coarseScore']:.6f}",
                    f"refined-score:{mapping['score']:.6f}",
                    f"practice-candidate-score:{candidate_score:.6f}",
                    f"practice-runner-up-score:{second_score:.6f}",
                    f"practice-candidate-margin:{candidate_margin:.6f}",
                    "practice-source-stratified-retrieval:v1",
                    f"practice-ambiguous-geometric-collision:{str(collision_risk).lower()}",
                    f"practice-scene-selection-mode:{selection_mode}",
                    *(
                        [
                            "practice-retained-truth-correction-applied:RERANK_SOURCE_IDENTITY",
                            f"practice-correction-case-id:{correction_case_id}",
                            f"practice-correction-detailed-per-source:{detailed_per_source_limit}",
                            f"practice-correction-detailed-global:{detailed_global_limit}",
                            f"practice-correction-continuity-max:{continuity_maximum_bonus:.6f}",
                        ]
                        if correction_applied else []
                    ),
                    *(
                        [
                            f"practice-geometric-rescue-score:{mapping['rescueScore']:.6f}",
                            f"practice-geometric-rescue-residual-ms:{mapping.get('rescueResidualMs', 0.0):.3f}",
                            "practice-geometric-rescue-full-verification:CLAHE_SIFT_SOFT_SIFT_LOW_CONTRAST_SIFT_PLUS_STRICT_ORB_ALL_ANCHORS_V4",
                        ]
                        if mapping.get("rescueScore") is not None
                        else []
                    ),
                    *[
                        f"practice-geometric-effect-feature-mode:{mode}"
                        for mode in mapping.get("geometricProof", {}).get("effectFeatureModes", [])
                    ],
                    f"practice-geometric-mean-support:{mapping.get('geometricProof', {}).get('meanSupport', 0.0):.6f}",
                    f"practice-geometric-strong-anchors:{mapping.get('geometricProof', {}).get('strongAnchorCount', 0)}",
                    f"practice-geometric-strong-fraction:{mapping.get('geometricProof', {}).get('strongAnchorFraction', 0.0):.6f}",
                    f"practice-geometric-max-inliers:{mapping.get('geometricProof', {}).get('maximumInlierCount', 0)}",
                    f"practice-geometric-mean-coverage:{mapping.get('geometricProof', {}).get('meanCoverage', 0.0):.6f}",
                    *(
                        [
                            f"practice-framing-stable:{str(mapping['geometricProof']['framing']['stable']).lower()}",
                            f"practice-framing-dynamic:{str(mapping['geometricProof']['framing'].get('dynamic', False)).lower()}",
                            f"practice-framing-confidence:{mapping['geometricProof']['framing']['confidence']:.6f}",
                            f"practice-framing-dynamic-confidence:{mapping['geometricProof']['framing'].get('dynamicConfidence', 0.0):.6f}",
                            f"practice-framing-stable-anchors:{mapping['geometricProof']['framing']['stableAnchorCount']}",
                            f"practice-framing-trajectory-points:{len(mapping['geometricProof']['framing'].get('trajectory', []))}",
                            f"practice-framing-position:{mapping['geometricProof']['framing']['positionX']:.3f},{mapping['geometricProof']['framing']['positionY']:.3f}",
                            f"practice-framing-scale-percent:{mapping['geometricProof']['framing']['scalePercent']:.6f}",
                            f"practice-framing-rotation-deg:{mapping['geometricProof']['framing']['rotationDegrees']:.6f}",
                        ]
                        if mapping.get("geometricProof", {}).get("framing") is not None
                        else []
                    ),
                    f"practice-temporal-behavior:{temporal_behavior}",
                    *boundary_evidence,
                    *(
                        [
                            f"practice-source-continuity-prior:{continuity_source_id}",
                            f"practice-source-continuity-bonus:{continuity_bonus:.6f}",
                        ]
                        if continuity_applied
                        else []
                    ),
                    *(
                        [f"practice-rewind-span-ms:{rewind['rewindSpanMs']:.3f}"]
                        if rewind is not None else []
                    ),
                ],
            })
            attempted.add(shot["shotId"])
            save_checkpoint()
            print(json.dumps({"schema": "editflow.practice-match-progress.v1",
                              "match": matches[-1]}), flush=True)
    finally:
        reference_reader.close()
        for reader in source_readers.values():
            reader.close()


    payload = {
        "schema": "editflow.practice-scene-matches.v1",
        "referenceId": reference["referenceId"],
        "analysis": {
            "algorithmId": ALGORITHM_ID,
            "analyzerFingerprint": analyzer_fingerprint(),
            "coarseCandidateLimit": coarse_limit,
            "coarseCandidateStrategy": "SOURCE_BALANCED_TEMPORAL_V2",
            "refinementMode": "PROXY_PROGRESSIVE_SOURCE_BALANCED_GEOMETRIC_V3",
            "geometricVerificationMode": "SOURCE_BEST_PLUS_TOP4_THREE_ANCHOR_THEN_STABLE_FULL_FINALISTS_V2",
            "geometricFinalizationMode": "ITERATIVE_FULL_WINNER_DISTINCT_RUNNER_UP_V1",
            "geometricRankingMinimumStrongAnchors": 2,
            "geometricRankingSampledAnchors": 3,
            "geometricRescueMode": "BOUNDED_THREE_ANCHOR_COHERENT_PATH_V1",
            "geometricRescuePhotometricNormalization": "CLAHE_V1",
            "geometricRescueEffectEvidenceMode": "CLAHE_SIFT_SOFT_SIFT_LOW_CONTRAST_SIFT_PLUS_STRICT_ORB_FALLBACK_V1",
            "geometricRescueOrbMinimumInliers": 12,
            "geometricRescueOrbMinimumInlierRatio": 0.55,
            "geometricRescueOrbMinimumCoverage": 0.02,
            "geometricRescueOrbMinimumSupport": 0.72,
            "geometricRescueFullVerificationMode": "CLAHE_SIFT_SOFT_SIFT_LOW_CONTRAST_SIFT_PLUS_STRICT_ORB_ALL_ANCHORS_V4",
            "geometricRescueMaximumSamplesPerSource": 480,
            "geometricRescueMinimumStrongAnchors": 2,
            "geometricRescueMinimumMeanSupport": 0.60,
            "geometricRescueMaximumResidualMs": 180.0,
            "geometricRescueExactMinimumStrongAnchors": 3,
            "geometricRescueExactMinimumScore": 0.82,
            "geometricRescueExactMinimumCandidateMargin": 0.08,
            "sourceContinuityMode": "REFERENCE_BOUNDARY_V1",
            "sourceContinuityIdentityGate": "CONFIDENCE_0_80_PLUS_REPEATED_GEOMETRY_V1",
            "sourceContinuityThreshold": 0.70,
            "sourceContinuityMaximumBonus": 0.06,
            "detailedCandidatePerSourceLimit": 2,
            "detailedCandidateGlobalLimit": 4,
            "retainedTruthCorrectionReplayMode": (
                correction_profile.get("retrievalMode")
                if correction_profile is not None else None
            ),
            "retainedTruthCorrectionCaseId": (
                str(correction_case_id).strip()
                if correction_profile is not None else None
            ),
            "retainedTruthCorrectionDetailedPerSourceLimit": (
                int(correction_profile["detailedPerSourceLimit"])
                if correction_profile is not None else None
            ),
            "retainedTruthCorrectionDetailedGlobalLimit": (
                int(correction_profile["detailedGlobalLimit"])
                if correction_profile is not None else None
            ),
            "retainedTruthCorrectionContinuityMaximumBonus": (
                float(correction_profile["continuityMaximumBonus"])
                if correction_profile is not None else None
            ),
        },
        "sourceIndexIds": [item["sourceId"] for item in source_indexes],
        "matches": matches,
        "evidenceRefs": [
            *reference.get("evidenceRefs", []),
            *[
                ref
                for source_index in source_indexes
                for ref in source_index.get("evidenceRefs", [])
            ],
            f"practice-analyzer:sha256:{analyzer_fingerprint()}",
            "practice-scene-match-mode:PROXY_PROGRESSIVE_SOURCE_BALANCED_GEOMETRIC_V3",
            *(
                [
                    "practice-retained-truth-correction-profile-loaded:RERANK_SOURCE_IDENTITY",
                    f"practice-correction-case-id:{str(correction_case_id).strip()}",
                ]
                if correction_profile is not None else []
            ),
        ],
    }
    temporary_output = Path(str(output_path) + ".tmp-" + str(os.getpid()))
    temporary_output.write_text(json.dumps(payload, indent=2), encoding="utf-8", newline="\n")
    os.replace(temporary_output, output_path)
    return payload


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["match"])
    parser.add_argument("--reference-json", required=True)
    parser.add_argument("--source-index-json", action="append", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--coarse-limit", type=int, default=16)
    parser.add_argument("--correction-profile")
    parser.add_argument("--correction-case-id")
    parser.add_argument("--shot-id", action="append")
    parser.add_argument("--checkpoint")
    parser.add_argument("--seed-matches")
    args = parser.parse_args()
    if not 2 <= args.coarse_limit <= 64:
        raise ValueError("coarse-limit must be in [2, 64].")
    result = match_reference(args.reference_json, args.source_index_json, args.output,
        args.coarse_limit, args.correction_profile, args.correction_case_id,
        args.shot_id, args.checkpoint, args.seed_matches)
    print(json.dumps({"ok": True, "matchCount": len(result["matches"])}))
