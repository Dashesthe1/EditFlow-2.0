import csv
import hashlib
import importlib.util
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch


def load_tool():
    script = Path(__file__).resolve().parents[1] / "scripts" / "practice" / "practice-truth-population.py"
    spec = importlib.util.spec_from_file_location("practice_truth_population", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


tool = load_tool()
DIFFICULTIES = [
    "FAST_CUTS",
    "NEAR_DUPLICATE_SOURCES",
    "REVERSE_OR_REWIND",
    "IDENTITY_AMBIGUITY",
]


def write_json(path, payload):
    Path(path).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

def sha256_bytes(value):
    return hashlib.sha256(value).hexdigest()


def perceptual_signature(part):
    return ",".join([part] * 16)


class PracticeTruthPopulationTest(unittest.TestCase):
    def _base_case(self, root, index=0):
        finish = root / f"finish-{index}.mp4"
        source = root / f"source-{index}.mp4"
        finish.write_bytes(f"finish-{index}".encode())
        source.write_bytes(f"source-{index}".encode())
        return {
            "caseId": f"case-{index:02d}",
            "difficultyTags": [DIFFICULTIES[index % len(DIFFICULTIES)]],
            "finishPath": finish.name,
            "sourceMedia": [{
                "sourceId": f"video:{index:02d}",
                "path": source.name,
            }],
            "referenceAnalysis": f"reference-{index}.json",
            "truthDraft": f"truth-draft-{index}.json",
            "reviewPackDir": f"review-{index}",
            "retainedTruth": f"truth-retained-{index}.json",
            "matches": f"matches-{index}.json",
            "suiteManifest": f"suite-{index}.json",
        }

    def _plan(self, root, cases):
        path = root / "population.json"
        write_json(path, {
            "schema": tool.POPULATION_SCHEMA,
            "editTypeId": "edit-type:test",
            "cases": cases,
        })
        return path

    def _bound_candidate_fixture(
        self,
        root,
        *,
        source_id="video:new",
        signature=None,
        expected_source_sha=None,
    ):
        finish = root / "candidate-finish.mp4"
        source = root / "candidate-source.mp4"
        finish.write_bytes(b"candidate-finish")
        source.write_bytes(b"candidate-source")
        source_sha = sha256_bytes(source.read_bytes())
        reference_path = root / "candidate-reference.json"
        write_json(reference_path, {
            "schema": tool.REFERENCE_SCHEMA,
            "referenceId": "reference:candidate",
            "sourceSha256": sha256_bytes(finish.read_bytes()),
            "perceptualSignature": signature or perceptual_signature("ffffffffffffffff"),
            "shots": [{"shotId": "shot:1", "referenceStartMs": 0, "referenceEndMs": 1000}],
        })
        binding_path = root / "candidate-binding.json"
        write_json(binding_path, {
            "schema": tool.SOURCE_BINDING_SCHEMA,
            "status": "BOUND",
            "referenceId": "reference:candidate",
            "referencePath": str(reference_path),
            "sourceBindings": [{
                "sourceId": source_id,
                "sourceSha256": expected_source_sha or source_sha,
            }],
        })
        return finish, source, binding_path

    def test_missing_reference_analysis_is_reported_as_next_action(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            case = self._base_case(root)
            status = tool.build_status(self._plan(root, [case]))
            self.assertEqual(status["cases"][0]["stage"], "REFERENCE_ANALYSIS")
            self.assertEqual(status["cases"][0]["nextAction"], "ANALYZE_REFERENCE")
            self.assertFalse(status["cases"][0]["readyForCorpus"])
            self.assertFalse(status["populationWindowReached"])

    def test_status_exposes_actionable_population_coverage_gaps(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            case = self._base_case(root)
            status = tool.build_status(self._plan(root, [case]))
            coverage = status["coverage"]

            self.assertEqual(coverage["targetCaseWindow"], {"min": 20, "max": 30})
            self.assertEqual(coverage["casesNeededForMinimum"], 19)
            self.assertEqual(coverage["targetDifficultyKinds"], 4)
            self.assertEqual(coverage["representedDifficultyKinds"], ["FAST_CUTS"])
            self.assertEqual(coverage["difficultyKindsNeeded"], 3)
            self.assertIn("REVERSE_OR_REWIND", coverage["unrepresentedDifficultyKinds"])
            self.assertEqual(coverage["targetDistinctSourceSets"], 3)
            self.assertEqual(coverage["distinctSourceSetCount"], 1)
            self.assertEqual(coverage["sourceSetsNeeded"], 2)
            self.assertEqual(coverage["sourceSetCounts"], {"video:00": 1})

    def test_twenty_candidate_window_is_separate_from_case_readiness(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            cases = [self._base_case(root, index) for index in range(20)]
            status = tool.build_status(self._plan(root, cases))
            self.assertTrue(status["populationWindowReached"])
            self.assertEqual(status["candidateCaseCount"], 20)
            self.assertEqual(status["readyForCorpusCount"], 0)
            self.assertEqual(status["stageCounts"], {"REFERENCE_ANALYSIS": 20})

    def test_candidate_window_rejects_single_source_set_population(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            cases = [self._base_case(root, index) for index in range(20)]
            shared_source = cases[0]["sourceMedia"]
            for case in cases:
                case["sourceMedia"] = shared_source

            status = tool.build_status(self._plan(root, cases))
            self.assertFalse(status["populationWindowReached"])
            self.assertEqual(status["coverage"]["distinctSourceSetCount"], 1)
            self.assertEqual(status["coverage"]["sourceSetsNeeded"], 2)
            self.assertTrue(any(
                "distinct Start source sets" in reason
                for reason in status["populationReasons"]
            ))

    def test_candidate_window_rejects_exact_finish_byte_reuse(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            cases = [self._base_case(root, index) for index in range(20)]
            original = root / cases[0]["finishPath"]
            duplicate = root / cases[1]["finishPath"]
            duplicate.write_bytes(original.read_bytes())

            status = tool.build_status(self._plan(root, cases))
            self.assertFalse(status["populationWindowReached"])
            self.assertTrue(any(
                "exact Finish media bytes" in reason
                for reason in status["populationReasons"]
            ))

    def test_candidate_window_rejects_perceptual_finish_reencode_reuse(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            cases = [self._base_case(root, index) for index in range(20)]
            signatures = [
                perceptual_signature("0000000000000000"),
                perceptual_signature("0000000000000001"),
            ]
            for index, signature in enumerate(signatures):
                write_json(root / cases[index]["referenceAnalysis"], {
                    "schema": tool.REFERENCE_SCHEMA,
                    "referenceId": f"reference:{index}",
                    "perceptualSignature": signature,
                })

            status = tool.build_status(self._plan(root, cases))
            self.assertFalse(status["populationWindowReached"])
            self.assertTrue(any(
                "perceptually equivalent Finish material" in reason
                for reason in status["populationReasons"]
            ))

    def _write_reference_and_draft(self, root, case):
        finish = root / case["finishPath"]
        source_id = case["sourceMedia"][0]["sourceId"]
        source = root / case["sourceMedia"][0]["path"]
        reference = {
            "schema": tool.REFERENCE_SCHEMA,
            "referenceId": "reference:fixture",
            "styleFingerprint": "style",
            "sourceSha256": sha256_bytes(finish.read_bytes()),
            "analysis": {"analyzerFingerprint": "analyzer"},
            "shots": [{"shotId": "shot:1", "referenceStartMs": 0, "referenceEndMs": 1000}],
        }

        write_json(root / case["referenceAnalysis"], reference)
        truth_tool = tool.load_media_truth_tool()
        draft = truth_tool.scaffold(
            reference,
            [source_id],
            {source_id: sha256_bytes(source.read_bytes())},
        )
        write_json(root / case["truthDraft"], draft)
        return reference

    def _write_complete_review_pack(self, root, case):
        truth_tool = tool.load_media_truth_tool()
        finish = root / case["finishPath"]
        source_id = case["sourceMedia"][0]["sourceId"]
        source = root / case["sourceMedia"][0]["path"]
        finish_sha = sha256_bytes(finish.read_bytes())
        source_sha = sha256_bytes(source.read_bytes())
        review = root / case["reviewPackDir"]
        preview_dir = review / "finish-previews"
        atlas_dir = review / "source-atlas" / "fixture"
        preview_dir.mkdir(parents=True, exist_ok=True)
        atlas_dir.mkdir(parents=True, exist_ok=True)
        finish_preview = preview_dir / "shot-1.png"
        source_preview = atlas_dir / "0001.png"
        finish_preview.write_bytes(b"finish-preview")
        source_preview.write_bytes(b"source-preview")
        write_json(review / "review-pack.json", {
            "schema": tool.REVIEW_PACK_SCHEMA,
            "finish": {"path": str(finish), "sha256": finish_sha},
            "sources": [{
                "sourceId": source_id,
                "path": str(source),
                "sha256": source_sha,
            }],
            "previews": [{
                "shotId": "shot:1",
                "previewPaths": [str(Path("finish-previews") / "shot-1.png")],
            }],
            "sourceAtlas": [{
                "sourceId": source_id,
                "sourceSha256": source_sha,
                "samples": [{
                    "timeMs": 1500.0,
                    "previewPath": str(Path("source-atlas") / "fixture" / "0001.png"),
                }],
            }],
            "policy": {
                "matcherSuggestionsAllowed": False,
                "matcherOutputMayBecomeTruth": False,
            },
        })
        with (review / "annotations.csv").open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=truth_tool.REVIEW_FIELDS)
            writer.writeheader()
            writer.writerow({
                "shotId": "shot:1",
                "referenceStartMs": "0",
                "referenceEndMs": "1000",
                "previewEarly": str(Path("finish-previews") / "shot-1.png"),
                "previewMiddle": str(Path("finish-previews") / "shot-1.png"),
                "previewLate": str(Path("finish-previews") / "shot-1.png"),
                "sourceId": source_id,
                "sourceStartMs": "1000",
                "sourceEndMs": "2000",
                "direction": "FORWARD",
                "toleranceMs": "",
                "notes": "Independent matcher-blind review.",
            })
        return review

    def test_work_queue_exposes_review_and_acquisition_dependencies(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            case = self._base_case(root)
            self._write_reference_and_draft(root, case)
            review = self._write_complete_review_pack(root, case)
            truth_tool = tool.load_media_truth_tool()
            with (review / "annotations.csv").open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=truth_tool.REVIEW_FIELDS)
                writer.writeheader()
                writer.writerow({
                    "shotId": "shot:1",
                    "referenceStartMs": "0",
                    "referenceEndMs": "1000",
                    "previewEarly": str(Path("finish-previews") / "shot-1.png"),
                    "previewMiddle": str(Path("finish-previews") / "shot-1.png"),
                    "previewLate": str(Path("finish-previews") / "shot-1.png"),
                    "sourceId": "",
                    "sourceStartMs": "",
                    "sourceEndMs": "",
                    "direction": "",
                    "toleranceMs": "",
                    "notes": "",
                })
            plan = self._plan(root, [case])
            discovery = root / "finish-discovery.json"
            write_json(discovery, {
                "schema": tool.DISCOVERY_SCHEMA,
                "perceptuallyUniqueUnusedFinishCount": 2,
                "canReachMinimumByScreenedUniqueFinishCount": False,
                "candidates": [
                    {
                        "path": "candidate-a.mp4",
                        "fileName": "Candidate A.mp4",
                        "sha256": "a" * 64,
                        "requiresSourceBinding": True,
                        "requiresReferenceAnalysis": True,
                    },
                    {
                        "path": "candidate-b.mp4",
                        "fileName": "Candidate B.mp4",
                        "sha256": "b" * 64,
                        "requiresSourceBinding": True,
                        "requiresReferenceAnalysis": False,
                    },
                ],
            })

            queue = tool.build_work_queue(plan, discovery)

            self.assertEqual(queue["schema"], tool.WORK_QUEUE_SCHEMA)
            self.assertEqual(queue["reviewableCaseCount"], 1)
            self.assertEqual(queue["readyToFinalizeCount"], 0)
            self.assertEqual(queue["remainingIndependentReviewShotCount"], 1)
            self.assertEqual(queue["queue"][0]["totalReferenceShotCount"], 1)
            self.assertEqual(queue["queue"][0]["remainingIndependentReviewShotCount"], 1)
            self.assertEqual(queue["acquisition"]["additionalCasesNeededForMinimum"], 19)
            self.assertEqual(queue["acquisition"]["additionalDistinctSourceSetsNeeded"], 2)
            self.assertTrue(queue["acquisition"]["sourceAcquisitionRequired"])
            self.assertEqual(
                queue["finishDiscovery"]["candidatesRequiringSourceBindingCount"],
                2,
            )
            self.assertEqual(queue["acquisition"]["unboundFinishCandidateCount"], 2)
            self.assertEqual(queue["acquisition"]["finishCandidateShortfallForMinimum"], 17)
            self.assertEqual(queue["finishDiscovery"]["finishCandidateShortfallForMinimum"], 17)
            self.assertEqual(
                queue["finishDiscovery"]["unboundFinishCandidates"],
                [
                    {
                        "path": "candidate-a.mp4",
                        "fileName": "Candidate A.mp4",
                        "sha256": "a" * 64,
                        "requiresReferenceAnalysis": True,
                        "sourceBindingState": "MISSING_EXACT_BOUND_START_SOURCE",
                    },
                    {
                        "path": "candidate-b.mp4",
                        "fileName": "Candidate B.mp4",
                        "sha256": "b" * 64,
                        "requiresReferenceAnalysis": False,
                        "sourceBindingState": "MISSING_EXACT_BOUND_START_SOURCE",
                    },
                ],
            )
            self.assertTrue(
                queue["acquisition"]["exactSourceBindingRequiredBeforeAdmission"]
            )
            self.assertTrue(any(
                "additional exact-bound cases" in item
                for item in queue["blockingDependencies"]
            ))
            self.assertTrue(any(
                "perceptually unique Finish candidate" in item
                for item in queue["blockingDependencies"]
            ))
            self.assertTrue(any(
                "matcher-blind shot annotations" in item
                for item in queue["blockingDependencies"]
            ))

    def test_acquisition_plan_schedules_exact_binding_tasks_for_minimum_cohort(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            case = self._base_case(root)
            plan = self._plan(root, [case])
            candidates = []
            for index in range(19):
                candidates.append({
                    "path": str(root / f"candidate-{index:02d}.mp4"),
                    "fileName": f"Candidate {index:02d}.mp4",
                    "sha256": f"{index + 1:064x}",
                    "requiresSourceBinding": True,
                    "requiresReferenceAnalysis": index % 2 == 0,
                })
            discovery = root / "finish-discovery.json"
            write_json(discovery, {
                "schema": tool.DISCOVERY_SCHEMA,
                "perceptuallyUniqueUnusedFinishCount": 19,
                "canReachMinimumByScreenedUniqueFinishCount": True,
                "candidates": candidates,
            })

            result = tool.build_acquisition_plan(plan, discovery)

            self.assertEqual(result["schema"], tool.ACQUISITION_PLAN_SCHEMA)
            self.assertTrue(result["candidatePoolReady"])
            self.assertEqual(result["targetNewCaseCount"], 19)
            self.assertEqual(result["selectedCandidateCount"], 19)
            self.assertEqual(result["finishCandidateShortfallForMinimum"], 0)
            self.assertEqual(len(result["tasks"]), 19)
            first = result["tasks"][0]
            self.assertEqual(first["caseIdSuggestion"], "retained-000000000000")
            self.assertEqual(first["requiredActions"], [
                "ANALYZE_REFERENCE",
                "BIND_EXACT_START_SOURCE",
                "ADMIT_BOUND_CASE",
            ])
            self.assertTrue(first["mustIncreaseDistinctSourceSets"])
            self.assertTrue(result["tasks"][1]["mustIncreaseDistinctSourceSets"])
            self.assertFalse(result["tasks"][2]["mustIncreaseDistinctSourceSets"])
            self.assertTrue(first["mustIncreaseDifficultyKinds"])
            self.assertTrue(result["tasks"][2]["mustIncreaseDifficultyKinds"])
            self.assertFalse(result["tasks"][3]["mustIncreaseDifficultyKinds"])
            self.assertIn("reference-analysis.json", first["artifactTargets"]["referenceAnalysis"])
            self.assertEqual(result["blockingReasons"], [])

    def test_acquisition_run_refuses_to_guess_missing_difficulty_evidence(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            plan = self._plan(root, [self._base_case(root)])
            source = root / "acquisition-source.mp4"
            source.write_bytes(b"acquisition-source")
            candidates = []
            for index in range(19):
                finish = root / f"candidate-{index:02d}.mp4"
                if index == 0:
                    finish.write_bytes(b"candidate-finish")
                candidates.append({
                    "path": str(finish),
                    "fileName": finish.name,
                    "sha256": sha256_bytes(finish.read_bytes()) if finish.is_file() else f"{index + 1:064x}",
                    "requiresSourceBinding": True,
                    "requiresReferenceAnalysis": True,
                })
            discovery = root / "finish-discovery.json"
            write_json(discovery, {
                "schema": tool.DISCOVERY_SCHEMA,
                "perceptuallyUniqueUnusedFinishCount": 19,
                "canReachMinimumByScreenedUniqueFinishCount": True,
                "candidates": candidates,
            })
            case_id = tool.build_acquisition_plan(plan, discovery)["tasks"][0]["caseIdSuggestion"]
            output_plan = root / "population-acquired.json"

            result = tool.execute_acquisition_plan(
                plan,
                discovery,
                output_plan,
                ["video:new=" + str(source)],
                case_ids=[case_id],
                matcher=object(),
                source_binding_tool=object(),
            )

            self.assertEqual(result["schema"], tool.ACQUISITION_RUN_SCHEMA)
            self.assertEqual(result["admittedCount"], 0)
            self.assertEqual(result["blockedCount"], 1)
            self.assertIn("Verified difficulty evidence", result["tasks"][0]["reasons"][0])
            self.assertEqual(len(tool.require_plan(plan)["cases"]), 1)
            self.assertEqual(len(tool.require_plan(output_plan)["cases"]), 1)

    def test_acquisition_run_admits_verified_exact_bound_case_to_new_plan(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            cases = [self._base_case(root, index) for index in range(19)]
            plan = self._plan(root, cases)
            finish = root / "candidate-new.mp4"
            source = root / "candidate-source-new.mp4"
            finish.write_bytes(b"candidate-new-finish")
            source.write_bytes(b"candidate-new-source")
            finish_sha = sha256_bytes(finish.read_bytes())
            source_sha = sha256_bytes(source.read_bytes())
            discovery = root / "finish-discovery.json"
            write_json(discovery, {
                "schema": tool.DISCOVERY_SCHEMA,
                "perceptuallyUniqueUnusedFinishCount": 1,
                "canReachMinimumByScreenedUniqueFinishCount": True,
                "candidates": [{
                    "path": str(finish),
                    "fileName": finish.name,
                    "sha256": finish_sha,
                    "requiresSourceBinding": True,
                    "requiresReferenceAnalysis": True,
                }],
            })
            case_id = tool.build_acquisition_plan(plan, discovery)["tasks"][0]["caseIdSuggestion"]

            def signature_provider(path):
                part = hashlib.sha256(str(Path(path).resolve()).encode()).hexdigest()[:16]
                return perceptual_signature(part)

            class FakeMatcher:
                def analyze_reference(self, video_path, reference_id, output_path, cut_threshold, minimum_shot_ms):
                    payload = {
                        "schema": tool.REFERENCE_SCHEMA,
                        "referenceId": reference_id,
                        "sourceSha256": sha256_bytes(Path(video_path).read_bytes()),
                        "perceptualSignature": signature_provider(video_path),
                        "shots": [{
                            "shotId": "shot:1",
                            "referenceStartMs": 0,
                            "referenceEndMs": 1000,
                        }],
                    }
                    write_json(output_path, payload)
                    return payload

            class FakeBindingTool:
                def bind_sources(
                    self,
                    reference_path,
                    output_path,
                    source_video_specs=None,
                    index_cache_dir=None,
                    matches_output=None,
                    coarse_limit=16,
                    minimum_coverage=0.98,
                ):
                    reference = tool.load_json(reference_path)
                    payload = {
                        "schema": tool.SOURCE_BINDING_SCHEMA,
                        "status": "BOUND",
                        "referenceId": reference["referenceId"],
                        "referencePath": str(Path(reference_path).resolve()),
                        "matchesPath": str(Path(matches_output).resolve()),
                        "sourceIndexPaths": [],
                        "sourceBindings": [{
                            "sourceId": "video:new",
                            "sourceSha256": source_sha,
                        }],
                        "reasons": [],
                    }
                    write_json(matches_output, {"schema": tool.MATCH_SCHEMA, "matches": []})
                    write_json(output_path, payload)
                    return payload

            output_plan = root / "population-acquired.json"
            result = tool.execute_acquisition_plan(
                plan,
                discovery,
                output_plan,
                ["video:new=" + str(source)],
                difficulty_specs=[case_id + "=FAST_CUTS"],
                case_ids=[case_id],
                matcher=FakeMatcher(),
                source_binding_tool=FakeBindingTool(),
                signature_provider=signature_provider,
            )

            self.assertEqual(result["admittedCount"], 1)
            self.assertEqual(result["blockedCount"], 0)
            self.assertEqual(result["tasks"][0]["status"], "ADMITTED")
            self.assertEqual(result["tasks"][0]["boundSourceIds"], ["video:new"])
            self.assertEqual(result["coverageProjection"]["casesNeededForMinimum"], 0)
            self.assertEqual(len(tool.require_plan(plan)["cases"]), 19)
            acquired = tool.require_plan(output_plan)
            self.assertEqual(len(acquired["cases"]), 20)
            self.assertEqual(acquired["cases"][-1]["caseId"], case_id)

    def test_review_pack_waits_for_independent_worksheet_completion(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            case = self._base_case(root)
            self._write_reference_and_draft(root, case)
            review = root / case["reviewPackDir"]
            review.mkdir()
            write_json(review / "review-pack.json", {
                "schema": tool.REVIEW_PACK_SCHEMA,
                "policy": {
                    "matcherSuggestionsAllowed": False,
                    "matcherOutputMayBecomeTruth": False,
                },
            })
            with (review / "annotations.csv").open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=[
                    "shotId", "sourceId", "sourceStartMs", "sourceEndMs", "direction"
                ])
                writer.writeheader()
                writer.writerow({"shotId": "shot:1"})

            status = tool.build_status(self._plan(root, [case]))
            self.assertEqual(status["cases"][0]["stage"], "INDEPENDENT_REVIEW")
            self.assertEqual(
                status["cases"][0]["nextAction"],
                "COMPLETE_INDEPENDENT_REVIEW",
            )

            with (review / "annotations.csv").open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=[
                    "shotId", "sourceId", "sourceStartMs", "sourceEndMs", "direction"
                ])
                writer.writeheader()
                writer.writerow({
                    "shotId": "shot:1",
                    "sourceId": case["sourceMedia"][0]["sourceId"],
                    "sourceStartMs": "1000",
                    "sourceEndMs": "2000",
                    "direction": "FORWARD",
                })
            status = tool.build_status(self._plan(root, [case]))
            self.assertEqual(status["cases"][0]["stage"], "TRUTH_RETENTION")
            self.assertEqual(
                status["cases"][0]["nextAction"],
                "FINALIZE_INDEPENDENT_REVIEW",
            )

    def test_invalid_completed_worksheet_cannot_advance_to_truth_retention(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            case = self._base_case(root)
            self._write_reference_and_draft(root, case)
            review = root / case["reviewPackDir"]
            review.mkdir()
            write_json(review / "review-pack.json", {
                "schema": tool.REVIEW_PACK_SCHEMA,
                "policy": {
                    "matcherSuggestionsAllowed": False,
                    "matcherOutputMayBecomeTruth": False,
                },
            })
            with (review / "annotations.csv").open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=[
                    "shotId", "sourceId", "sourceStartMs", "sourceEndMs", "direction"
                ])
                writer.writeheader()
                writer.writerow({
                    "shotId": "shot:1",
                    "sourceId": "video:not-allowed",
                    "sourceStartMs": "1000",
                    "sourceEndMs": "2000",
                    "direction": "FORWARD",
                })

            status = tool.build_status(self._plan(root, [case]))
            result = status["cases"][0]
            self.assertEqual(result["stage"], "INDEPENDENT_REVIEW")
            self.assertEqual(result["nextAction"], "COMPLETE_INDEPENDENT_REVIEW")
            self.assertTrue(any("sourceId must be one of" in reason for reason in result["reasons"]))

    def test_finalize_independent_review_retains_attests_and_invalidates_downstream(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            case = self._base_case(root)
            self._write_reference_and_draft(root, case)
            review = self._write_complete_review_pack(root, case)
            write_json(root / case["matches"], {"schema": tool.MATCH_SCHEMA, "matches": []})
            write_json(root / case["suiteManifest"], {"schema": tool.RETAINED_SUITE_SCHEMA})
            plan = self._plan(root, [case])

            result = tool.finalize_independent_reviews(
                plan,
                "INDEPENDENT_HUMAN",
                case_ids=[case["caseId"]],
            )

            self.assertEqual(result["schema"], tool.FINALIZE_SCHEMA)
            self.assertEqual(result["finalizedCount"], 1)
            self.assertEqual(result["failedCount"], 0)
            retained_path = root / case["retainedTruth"]
            attestation_path = review / "review-attestation.json"
            self.assertTrue(retained_path.is_file())
            self.assertTrue(attestation_path.is_file())
            retained = tool.load_json(retained_path)
            attestation = tool.load_json(attestation_path)
            self.assertEqual(retained["annotationOrigin"], "INDEPENDENT_HUMAN")
            self.assertTrue(attestation["matcherBlindWorkflowVerified"])
            self.assertEqual(
                attestation["retainedTruthSha256"],
                tool.sha256_file(retained_path),
            )
            self.assertFalse((root / case["matches"]).exists())
            self.assertFalse((root / case["suiteManifest"]).exists())
            self.assertEqual(
                result["cases"][0]["invalidatedDownstreamArtifacts"],
                ["matches", "suiteManifest"],
            )
            status = tool.build_status(plan)
            self.assertEqual(status["cases"][0]["stage"], "MATCHER_OBSERVATION")

    def test_finalizer_rechecks_live_media_identity_before_skip(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            case = self._base_case(root)
            self._write_reference_and_draft(root, case)
            self._write_complete_review_pack(root, case)
            plan = self._plan(root, [case])
            first = tool.finalize_independent_reviews(plan, "INDEPENDENT_HUMAN")
            self.assertEqual(first["finalizedCount"], 1)

            source_path = root / case["sourceMedia"][0]["path"]
            source_path.write_bytes(b"source-changed-after-attestation")
            second = tool.finalize_independent_reviews(plan, "INDEPENDENT_HUMAN")

            self.assertEqual(second["skippedCount"], 0)
            self.assertEqual(second["failedCount"], 1)
            self.assertIn("invalid or stale", second["cases"][0]["error"])

    def test_tampered_review_after_finalization_blocks_matcher_observation(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            case = self._base_case(root)
            self._write_reference_and_draft(root, case)
            review = self._write_complete_review_pack(root, case)
            plan = self._plan(root, [case])
            result = tool.finalize_independent_reviews(
                plan,
                "INDEPENDENT_EXTERNAL_TOOL",
            )
            self.assertEqual(result["failedCount"], 0)

            with (review / "annotations.csv").open("a", encoding="utf-8") as handle:
                handle.write("\n")

            status = tool.build_status(plan)
            observed = status["cases"][0]
            self.assertEqual(observed["stage"], "INDEPENDENT_REVIEW_ATTESTATION")
            self.assertEqual(observed["nextAction"], "FINALIZE_INDEPENDENT_REVIEW")
            self.assertTrue(any(
                "no longer matches the review worksheet" in reason
                for reason in observed["reasons"]
            ))

    def test_review_pack_rebuild_invalidates_prior_authority(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            case = self._base_case(root)
            self._write_reference_and_draft(root, case)
            review = self._write_complete_review_pack(root, case)
            plan = self._plan(root, [case])
            finalized = tool.finalize_independent_reviews(plan, "INDEPENDENT_HUMAN")
            self.assertEqual(finalized["finalizedCount"], 1)
            write_json(root / case["matches"], {"schema": tool.MATCH_SCHEMA, "matches": []})
            write_json(root / case["suiteManifest"], {"schema": tool.RETAINED_SUITE_SCHEMA})

            (review / "finish-previews" / "shot-1.png").unlink()

            class FakeTruthTool:
                @staticmethod
                def build_review_pack(**_kwargs):
                    rebuilt_review = self._write_complete_review_pack(root, case)
                    return tool.load_json(rebuilt_review / "review-pack.json")

            prepared = tool.prepare_review_packs(plan, media_truth=FakeTruthTool())
            self.assertEqual(prepared["preparedCount"], 1)
            self.assertEqual(
                prepared["cases"][0]["invalidatedArtifacts"],
                ["reviewAttestation", "retainedTruth", "matches", "suiteManifest"],
            )
            self.assertFalse((review / "review-attestation.json").exists())
            self.assertFalse((root / case["retainedTruth"]).exists())
            self.assertFalse((root / case["matches"]).exists())
            self.assertFalse((root / case["suiteManifest"]).exists())

    def test_prepare_review_packs_refreshes_missing_source_atlas_and_then_skips(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            case = self._base_case(root)
            self._write_reference_and_draft(root, case)
            plan = self._plan(root, [case])
            calls = []

            class FakeTruthTool:
                @staticmethod
                def build_review_pack(**kwargs):
                    calls.append(kwargs)
                    review_dir = Path(kwargs["output_dir"])
                    source_id = next(iter(kwargs["source_paths_by_id"]))
                    source_path = Path(kwargs["source_paths_by_id"][source_id])
                    source_hash = sha256_bytes(source_path.read_bytes())
                    finish_path = Path(kwargs["finish_path"])
                    finish_hash = sha256_bytes(finish_path.read_bytes())
                    atlas_dir = review_dir / "source-atlas" / "fixture"
                    atlas_dir.mkdir(parents=True, exist_ok=True)
                    preview = atlas_dir / "0001.png"
                    preview.write_bytes(b"atlas")
                    finish_preview_dir = review_dir / "finish-previews"
                    finish_preview_dir.mkdir(parents=True, exist_ok=True)
                    finish_preview = finish_preview_dir / "shot-1.png"
                    finish_preview.write_bytes(b"finish")
                    (review_dir / "annotations.csv").write_text(
                        "shotId,sourceId,sourceStartMs,sourceEndMs,direction\n",
                        encoding="utf-8",
                    )
                    manifest = {
                        "schema": tool.REVIEW_PACK_SCHEMA,
                        "finish": {"path": str(finish_path), "sha256": finish_hash},
                        "sources": [{
                            "sourceId": source_id,
                            "path": str(source_path),
                            "sha256": source_hash,
                        }],
                        "previews": [{
                            "shotId": "shot:1",
                            "previewPaths": [
                                str(Path("finish-previews") / "shot-1.png"),
                            ],
                        }],
                        "sourceAtlas": [{
                            "sourceId": source_id,
                            "sourceSha256": source_hash,
                            "samples": [{
                                "timeMs": 1000.0,
                                "previewPath": str(Path("source-atlas") / "fixture" / "0001.png"),
                            }],
                        }],
                        "policy": {
                            "matcherSuggestionsAllowed": False,
                            "matcherOutputMayBecomeTruth": False,
                        },
                    }
                    write_json(review_dir / "review-pack.json", manifest)
                    return manifest

            prepared = tool.prepare_review_packs(plan, media_truth=FakeTruthTool())
            self.assertEqual(prepared["preparedCount"], 1)
            self.assertEqual(prepared["failedCount"], 0)
            self.assertEqual(len(calls), 1)
            self.assertEqual(calls[0]["source_atlas_interval_ms"], tool.DEFAULT_SOURCE_ATLAS_INTERVAL_MS)
            expected_cache = str(plan.resolve().parent / ".source-atlas-cache")
            self.assertEqual(calls[0]["source_atlas_cache_dir"], expected_cache)
            self.assertEqual(prepared["sourceAtlasCacheDir"], expected_cache)

            skipped = tool.prepare_review_packs(plan, media_truth=FakeTruthTool())
            self.assertEqual(skipped["skippedCount"], 1)
            self.assertEqual(len(calls), 1)

            source_path = root / case["sourceMedia"][0]["path"]
            source_path.write_bytes(b"source-mutated")
            refreshed_identity = tool.prepare_review_packs(plan, media_truth=FakeTruthTool())
            self.assertEqual(refreshed_identity["preparedCount"], 1)
            self.assertEqual(refreshed_identity["skippedCount"], 0)
            self.assertEqual(len(calls), 2)

            finish_path = root / case["finishPath"]
            finish_path.write_bytes(b"finish-mutated")
            refreshed_finish_identity = tool.prepare_review_packs(
                plan,
                media_truth=FakeTruthTool(),
            )
            self.assertEqual(refreshed_finish_identity["preparedCount"], 1)
            self.assertEqual(refreshed_finish_identity["skippedCount"], 0)
            self.assertEqual(len(calls), 3)

            preview_path = root / case["reviewPackDir"] / "source-atlas" / "fixture" / "0001.png"
            preview_path.unlink()
            refreshed = tool.prepare_review_packs(plan, media_truth=FakeTruthTool())
            self.assertEqual(refreshed["preparedCount"], 1)
            self.assertEqual(len(calls), 4)

            finish_preview_path = (
                root / case["reviewPackDir"] / "finish-previews" / "shot-1.png"
            )
            finish_preview_path.unlink()
            refreshed = tool.prepare_review_packs(plan, media_truth=FakeTruthTool())
            self.assertEqual(refreshed["preparedCount"], 1)
            self.assertEqual(len(calls), 5)

    def test_prepare_review_packs_scaffolds_missing_truth_draft(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            case = self._base_case(root)
            self._write_reference_and_draft(root, case)
            draft_path = root / case["truthDraft"]
            draft_path.unlink()
            plan = self._plan(root, [case])
            scaffold_calls = []

            class FakeTruthTool:
                @staticmethod
                def scaffold(reference, source_ids, source_hashes):
                    scaffold_calls.append((reference, list(source_ids), dict(source_hashes)))
                    return {
                        "schema": tool.TRUTH_SCHEMA,
                        "status": "DRAFT",
                        "referenceId": reference["referenceId"],
                        "allowedSourceIds": list(source_ids),
                        "allowedSourceSha256": dict(source_hashes),
                        "shots": [],
                    }

                @staticmethod
                def build_review_pack(**kwargs):
                    review_dir = Path(kwargs["output_dir"])
                    source_id = next(iter(kwargs["source_paths_by_id"]))
                    atlas_dir = review_dir / "source-atlas" / "fixture"
                    atlas_dir.mkdir(parents=True, exist_ok=True)
                    preview = atlas_dir / "0001.png"
                    preview.write_bytes(b"atlas")
                    manifest = {
                        "schema": tool.REVIEW_PACK_SCHEMA,
                        "sourceAtlas": [{
                            "sourceId": source_id,
                            "samples": [{"previewPath": str(Path("source-atlas") / "fixture" / "0001.png")}],
                        }],
                    }
                    write_json(review_dir / "review-pack.json", manifest)
                    return manifest

            prepared = tool.prepare_review_packs(plan, media_truth=FakeTruthTool())
            self.assertEqual(prepared["preparedCount"], 1)
            self.assertTrue(prepared["cases"][0]["truthScaffoldCreated"])
            self.assertTrue(draft_path.is_file())
            self.assertEqual(len(scaffold_calls), 1)
            self.assertEqual(scaffold_calls[0][1], [case["sourceMedia"][0]["sourceId"]])
            self.assertEqual(
                scaffold_calls[0][2][case["sourceMedia"][0]["sourceId"]],
                sha256_bytes((root / case["sourceMedia"][0]["path"]).read_bytes()),
            )

    def test_prepare_review_packs_can_resume_selected_case_only(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            cases = [self._base_case(root, index) for index in range(2)]
            for case in cases:
                self._write_reference_and_draft(root, case)
            plan = self._plan(root, cases)
            prepared_ids = []

            class FakeTruthTool:
                @staticmethod
                def build_review_pack(**kwargs):
                    review_dir = Path(kwargs["output_dir"])
                    selected = next(
                        case for case in cases
                        if review_dir == (root / case["reviewPackDir"]).resolve()
                    )
                    prepared_ids.append(selected["caseId"])
                    source_id = next(iter(kwargs["source_paths_by_id"]))
                    atlas_dir = review_dir / "source-atlas" / "fixture"
                    atlas_dir.mkdir(parents=True, exist_ok=True)
                    preview = atlas_dir / "0001.png"
                    preview.write_bytes(b"atlas")
                    manifest = {
                        "schema": tool.REVIEW_PACK_SCHEMA,
                        "sourceAtlas": [{
                            "sourceId": source_id,
                            "samples": [{"previewPath": str(Path("source-atlas") / "fixture" / "0001.png")}],
                        }],
                    }
                    write_json(review_dir / "review-pack.json", manifest)
                    return manifest

            payload = tool.prepare_review_packs(
                plan,
                case_ids=[cases[1]["caseId"]],
                media_truth=FakeTruthTool(),
            )
            self.assertEqual(prepared_ids, [cases[1]["caseId"]])
            self.assertEqual([item["caseId"] for item in payload["cases"]], [cases[1]["caseId"]])
            with self.assertRaisesRegex(ValueError, "Unknown population case id"):
                tool.prepare_review_packs(plan, case_ids=["case-does-not-exist"], media_truth=FakeTruthTool())

    def test_finish_discovery_excludes_planned_and_exact_duplicate_media(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            scan = root / "finish-library"
            scan.mkdir()
            case = self._base_case(root)
            plan = self._plan(root, [case])

            planned_bytes = (root / case["finishPath"]).read_bytes()
            (scan / "planned-copy.mp4").write_bytes(planned_bytes)
            (scan / "new-a.mp4").write_bytes(b"new-a")
            (scan / "new-a-copy.mov").write_bytes(b"new-a")
            (scan / "ignore.txt").write_text("not video", encoding="utf-8")

            result = tool.discover_finish_candidates(plan, [scan])
            self.assertEqual(result["schema"], tool.DISCOVERY_SCHEMA)
            self.assertEqual(result["plannedCaseCount"], 1)
            self.assertEqual(result["casesNeededForMinimum"], 19)
            self.assertEqual(result["scannedVideoCount"], 3)
            self.assertEqual(result["exactUniqueUnusedFinishCount"], 1)
            self.assertEqual(result["exactDuplicateFinishCount"], 2)
            self.assertFalse(result["canReachMinimumByExactUniqueFinishCount"])
            candidate = result["candidates"][0]
            self.assertIn(candidate["fileName"], {"new-a.mp4", "new-a-copy.mov"})
            self.assertTrue(candidate["requiresSourceBinding"])
            self.assertTrue(candidate["requiresPerceptualScreening"])

    def test_finish_discovery_recurses_and_perceptually_rejects_near_duplicates(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            scan = root / "finish-library"
            nested = scan / "nested"
            nested.mkdir(parents=True)
            case = self._base_case(root)
            write_json(root / case["referenceAnalysis"], {
                "schema": tool.REFERENCE_SCHEMA,
                "referenceId": "reference:planned",
                "perceptualSignature": perceptual_signature("0000000000000000"),
            })
            plan = self._plan(root, [case])
            (nested / "near.mp4").write_bytes(b"near")
            (nested / "distinct.mp4").write_bytes(b"distinct")

            signatures = {
                "near.mp4": perceptual_signature("0000000000000001"),
                "distinct.mp4": perceptual_signature("ffffffffffffffff"),
            }
            result = tool.discover_finish_candidates(
                plan,
                [scan],
                perceptual_screen=True,
                signature_provider=lambda path: signatures[path.name],
            )

            self.assertTrue(result["scanRecursive"])
            self.assertTrue(result["perceptualScreeningEnabled"])
            self.assertEqual(result["scannedVideoCount"], 2)
            self.assertEqual(result["exactUniqueUnusedFinishCount"], 2)
            self.assertEqual(result["perceptualDuplicateFinishCount"], 1)
            self.assertEqual(result["perceptualScreeningFailureCount"], 0)
            self.assertEqual(result["perceptuallyUniqueUnusedFinishCount"], 1)
            self.assertEqual(result["candidates"][0]["fileName"], "distinct.mp4")
            self.assertFalse(result["candidates"][0]["requiresPerceptualScreening"])
            duplicate = result["perceptualDuplicates"][0]
            self.assertEqual(duplicate["fileName"], "near.mp4")
            self.assertEqual(duplicate["duplicateOfCaseId"], case["caseId"])
            self.assertGreaterEqual(duplicate["similarity"], tool.PERCEPTUAL_DUPLICATE_SIMILARITY)

    def test_finish_discovery_fails_closed_when_perceptual_screening_cannot_read_media(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            scan = root / "finish-library"
            scan.mkdir()
            case = self._base_case(root)
            plan = self._plan(root, [case])
            (scan / "unreadable.mp4").write_bytes(b"candidate")

            result = tool.discover_finish_candidates(
                plan,
                [scan],
                perceptual_screen=True,
                signature_provider=lambda _path: (_ for _ in ()).throw(RuntimeError("decode failed")),
            )

            self.assertEqual(result["perceptualScreeningFailureCount"], 1)
            self.assertEqual(result["perceptuallyUniqueUnusedFinishCount"], 0)
            self.assertTrue(result["candidates"][0]["requiresPerceptualScreening"])
            self.assertIn("decode failed", result["candidates"][0]["perceptualScreeningError"])

    def test_bound_candidate_admission_retains_only_proven_start_sources(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            existing = self._base_case(root)
            write_json(root / existing["referenceAnalysis"], {
                "schema": tool.REFERENCE_SCHEMA,
                "referenceId": "reference:existing",
                "perceptualSignature": perceptual_signature("0000000000000000"),
            })
            plan = self._plan(root, [existing])
            finish, source, binding = self._bound_candidate_fixture(
                root,
                source_id="video:new",
            )
            unused = root / "unused-source.mp4"
            unused.write_bytes(b"unused-source")

            result = tool.admit_bound_case(
                plan,
                "case-new",
                finish,
                binding,
                [
                    f"video:new={source}",
                    f"video:unused={unused}",
                ],
                ["STRONG_CAMERA_MOTION"],
                case_dir="case-new-artifacts",
            )

            admitted = result["plan"]["cases"][-1]
            self.assertEqual(
                admitted["sourceMedia"],
                [{"sourceId": "video:new", "path": str(source.resolve())}],
            )
            self.assertEqual(result["admission"]["boundSourceIds"], ["video:new"])
            self.assertEqual(
                result["admission"]["ignoredUnboundSourceIds"],
                ["video:unused"],
            )
            coverage = result["admission"]["coverageProjection"]
            self.assertEqual(result["admission"]["candidateCaseCount"], 2)
            self.assertEqual(coverage["distinctSourceSetCount"], 2)
            self.assertEqual(coverage["sourceSetsNeeded"], 1)
            self.assertIn("STRONG_CAMERA_MOTION", coverage["representedDifficultyKinds"])

    def test_bound_candidate_admission_rejects_malformed_bound_source_identity(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            existing = self._base_case(root)
            write_json(root / existing["referenceAnalysis"], {
                "schema": tool.REFERENCE_SCHEMA,
                "referenceId": "reference:existing",
                "perceptualSignature": perceptual_signature("0000000000000000"),
            })
            plan = self._plan(root, [existing])
            finish, source, binding = self._bound_candidate_fixture(
                root,
                expected_source_sha="g" * 64,
            )

            with self.assertRaisesRegex(ValueError, "invalid source identity"):
                tool.admit_bound_case(
                    plan,
                    "case-new",
                    finish,
                    binding,
                    [f"video:new={source}"],
                    ["OCCLUSION"],
                )

    def test_bound_candidate_admission_rejects_changed_start_source_identity(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            existing = self._base_case(root)
            write_json(root / existing["referenceAnalysis"], {
                "schema": tool.REFERENCE_SCHEMA,
                "referenceId": "reference:existing",
                "perceptualSignature": perceptual_signature("0000000000000000"),
            })
            plan = self._plan(root, [existing])
            finish, source, binding = self._bound_candidate_fixture(
                root,
                expected_source_sha="f" * 64,
            )

            with self.assertRaisesRegex(ValueError, "content identity changed"):
                tool.admit_bound_case(
                    plan,
                    "case-new",
                    finish,
                    binding,
                    [f"video:new={source}"],
                    ["OCCLUSION"],
                )

    def test_bound_candidate_admission_rejects_perceptual_finish_reuse(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            existing = self._base_case(root)
            write_json(root / existing["referenceAnalysis"], {
                "schema": tool.REFERENCE_SCHEMA,
                "referenceId": "reference:existing",
                "perceptualSignature": perceptual_signature("0000000000000000"),
            })
            plan = self._plan(root, [existing])
            finish, source, binding = self._bound_candidate_fixture(
                root,
                signature=perceptual_signature("0000000000000001"),
            )

            with self.assertRaisesRegex(ValueError, "perceptually equivalent"):
                tool.admit_bound_case(
                    plan,
                    "case-new",
                    finish,
                    binding,
                    [f"video:new={source}"],
                    ["HEAVY_EFFECT_OBSCURATION"],
                )

    def test_complete_single_case_reaches_corpus_ready_without_certifying_population(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            case = self._base_case(root)
            reference = self._write_reference_and_draft(root, case)
            finish = root / case["finishPath"]
            source = root / case["sourceMedia"][0]["path"]
            finish_sha = sha256_bytes(finish.read_bytes())
            source_sha = sha256_bytes(source.read_bytes())
            source_id = case["sourceMedia"][0]["sourceId"]
            self._write_complete_review_pack(root, case)
            plan = self._plan(root, [case])
            finalization = tool.finalize_independent_reviews(
                plan,
                "INDEPENDENT_HUMAN",
            )
            self.assertEqual(finalization["failedCount"], 0)
            write_json(root / case["matches"], {
                "schema": tool.MATCH_SCHEMA,
                "matches": [],
                "evidenceRefs": ["matcher:fixture"],
            })

            suite = {
                "schema": tool.RETAINED_SUITE_SCHEMA,
                "editTypeId": "edit-type:test",
                "mode": "MEASURE_ONLY",
                "cases": [{
                    "finishPath": finish.name,
                    "sourceMedia": [{"path": source.name, "sha256": source_sha}],
                    "truth": {
                        "caseId": case["caseId"],
                        "referenceId": reference["referenceId"],
                        "finishSha256": finish_sha,
                        "referenceDurationMs": 1000,
                        "sourceMediaSha256": [source_sha],
                        "truthAuthority": "INDEPENDENT_HUMAN",
                        "difficultyTags": case["difficultyTags"],
                        "shots": [{
                            "shotId": "shot:1",
                            "order": 0,
                            "referenceStartMs": 0,
                            "referenceEndMs": 1000,
                            "expectedSourceId": source_id,
                            "expectedSourceStartMs": 1000,
                            "expectedSourceEndMs": 2000,
                            "expectedDirection": "FORWARD",
                            "truthEvidenceRefs": ["independent:shot"],
                        }],
                        "evidenceRefs": ["independent:case"],
                    },

                    "observation": {
                        "caseId": case["caseId"],
                        "matches": [],
                        "evidenceRefs": ["practice-match-observation:sha256:" + ("a" * 64)],
                    },
                }],
            }
            write_json(root / case["suiteManifest"], suite)
            status = tool.build_status(self._plan(root, [case]))
            self.assertEqual(status["cases"][0]["stage"], "READY_FOR_CORPUS")
            self.assertTrue(status["cases"][0]["readyForCorpus"])
            self.assertEqual(status["readyForCorpusCount"], 1)
            self.assertFalse(status["populationWindowReached"])


    def test_advance_stops_before_retention_without_annotation_origin(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            case = self._base_case(root)
            self._write_reference_and_draft(root, case)
            self._write_complete_review_pack(root, case)
            plan = self._plan(root, [case])

            class FailingMatcher:
                def __getattr__(self, name):
                    raise AssertionError("matcher must not run before truth retention: " + name)

            result = tool.advance_population(plan, matcher=FailingMatcher())

            self.assertEqual(result["failedCount"], 0)
            self.assertEqual(result["waitingAnnotationOriginCount"], 1)
            observed = result["cases"][0]
            self.assertEqual(observed["outcome"], "WAITING_FOR_ANNOTATION_ORIGIN")
            self.assertEqual(observed["operations"], [])
            self.assertEqual(observed["nextAction"], "FINALIZE_INDEPENDENT_REVIEW")
            self.assertFalse((root / case["retainedTruth"]).exists())
            self.assertFalse((root / case["matches"]).exists())

    def test_advance_refuses_to_force_stale_review_authority(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            case = self._base_case(root)
            self._write_reference_and_draft(root, case)
            review = self._write_complete_review_pack(root, case)
            plan = self._plan(root, [case])
            finalized = tool.finalize_independent_reviews(plan, "INDEPENDENT_HUMAN")
            self.assertEqual(finalized["failedCount"], 0)
            with (review / "annotations.csv").open("a", encoding="utf-8") as handle:
                handle.write("\n")

            class FailingMatcher:
                def __getattr__(self, name):
                    raise AssertionError("matcher must not run against stale authority: " + name)

            result = tool.advance_population(
                plan,
                annotation_origin="INDEPENDENT_HUMAN",
                matcher=FailingMatcher(),
            )

            self.assertEqual(result["waitingReviewRecheckCount"], 1)
            observed = result["cases"][0]
            self.assertEqual(observed["outcome"], "WAITING_FOR_REVIEW_RECHECK")
            self.assertEqual(observed["operations"], [])
            self.assertEqual(observed["nextAction"], "FINALIZE_INDEPENDENT_REVIEW")
            self.assertFalse((root / case["matches"]).exists())

    def test_advance_runs_matcher_only_after_attested_truth_and_builds_suite(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            case = self._base_case(root)
            self._write_reference_and_draft(root, case)
            review = self._write_complete_review_pack(root, case)
            plan = self._plan(root, [case])
            matcher_calls = []

            class FakeMatcher:
                @staticmethod
                def analyzer_fingerprint():
                    return "fake-analyzer-fingerprint"

                @staticmethod
                def load_artifact(path, expected_schema):
                    payload = tool.load_json(path)
                    if payload.get("schema") != expected_schema:
                        raise ValueError("unexpected schema")
                    return payload

                @staticmethod
                def index_source(
                    video_path,
                    source_id,
                    output_path,
                    sample_step_ms,
                    explicit_ffmpeg=None,
                    proxy_dir=None,
                    analysis_fps=tool.DEFAULT_MATCHER_ANALYSIS_FPS,
                ):
                    matcher_calls.append("index")
                    payload = {
                        "schema": "editflow.practice-source-index.v1",
                        "sourceId": source_id,
                        "sourceSha256": tool.sha256_file(video_path),
                        "analysis": {
                            "algorithmId": "fake",
                            "analyzerFingerprint": "fake-analyzer-fingerprint",
                            "sampleStepMs": sample_step_ms,
                            "analysisProxyFps": analysis_fps,
                        },
                        "samples": [{"timeMs": 0.0, "descriptor": {}}],
                    }
                    write_json(output_path, payload)
                    return payload

                @staticmethod
                def match_reference(reference_path, source_index_paths, output_path, coarse_limit):
                    self.assertTrue((review / "review-attestation.json").is_file())
                    self.assertTrue((root / case["retainedTruth"]).is_file())
                    matcher_calls.append("match")
                    payload = {
                        "schema": tool.MATCH_SCHEMA,
                        "analysis": {
                            "algorithmId": "fake",
                            "analyzerFingerprint": "fake-analyzer-fingerprint",
                        },
                        "matches": [],
                        "evidenceRefs": ["practice-match-observation:fake"],
                    }
                    write_json(output_path, payload)
                    return payload

            result = tool.advance_population(
                plan,
                annotation_origin="INDEPENDENT_EXTERNAL_TOOL",
                matcher=FakeMatcher(),
            )

            self.assertEqual(result["failedCount"], 0)
            self.assertEqual(result["readyForCorpusCount"], 1)
            observed = result["cases"][0]
            self.assertEqual(observed["outcome"], "READY_FOR_CORPUS")
            self.assertEqual(
                observed["operations"],
                [
                    "FINALIZE_INDEPENDENT_REVIEW",
                    "RUN_MATCHER_OBSERVATION",
                    "BUILD_SUITE_MANIFEST",
                ],
            )
            self.assertEqual(matcher_calls, ["index", "match"])
            self.assertTrue((root / case["matches"]).is_file())
            self.assertTrue((root / case["suiteManifest"]).is_file())
            self.assertEqual(observed["nextAction"], "NONE")

    def test_progression_gate_blocks_incomplete_population(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            case = self._base_case(root)
            plan = self._plan(root, [case])

            gate = tool.build_progression_gate(plan)

            self.assertEqual(gate["schema"], tool.PROGRESSION_GATE_SCHEMA)
            self.assertFalse(gate["retainedEvaluationAllowed"])
            self.assertFalse(gate["robustPopulationPrerequisiteSatisfied"])
            self.assertEqual(gate["candidateCaseCount"], 1)
            self.assertEqual(gate["readyForCorpusCount"], 0)
            self.assertGreater(gate["pendingCaseCount"], 0)
            self.assertTrue(any(
                "at least 20 planned real-media cases" in reason
                for reason in gate["blockingReasons"]
            ))

    def test_progression_gate_opens_only_when_entire_cohort_is_ready(self):
        ready_status = {
            "editTypeId": "edit-type:test",
            "candidateCaseCount": 20,
            "readyForCorpusCount": 20,
            "populationWindowReached": True,
            "populationReasons": [],
        }
        ready_queue = {
            "remainingIndependentReviewShotCount": 0,
            "acquisition": {
                "additionalCasesNeededForMinimum": 0,
                "additionalDistinctSourceSetsNeeded": 0,
                "additionalDifficultyKindsNeeded": 0,
                "sourceAcquisitionRequired": False,
            },
            "queue": [
                {"caseId": f"case-{index:02d}", "nextAction": "NONE"}
                for index in range(20)
            ],
        }
        with patch.object(tool, "build_status", return_value=ready_status), patch.object(
            tool,
            "build_work_queue",
            return_value=ready_queue,
        ):
            gate = tool.build_progression_gate("population.json")

        self.assertTrue(gate["retainedEvaluationAllowed"])
        self.assertTrue(gate["robustPopulationPrerequisiteSatisfied"])
        self.assertEqual(gate["pendingCaseCount"], 0)
        self.assertEqual(gate["remainingIndependentReviewShotCount"], 0)
        self.assertEqual(gate["blockingReasons"], [])


if __name__ == "__main__":
    unittest.main()
