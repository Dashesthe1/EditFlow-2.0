import csv
import hashlib
import importlib.util
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


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
        write_json(root / case["truthDraft"], {
            "schema": tool.TRUTH_SCHEMA,
            "status": "DRAFT",
            "referenceId": "reference:fixture",
            "allowedSourceIds": [source_id],
            "allowedSourceSha256": {source_id: sha256_bytes(source.read_bytes())},
            "shots": [{
                "shotId": "shot:1",
                "sourceId": None,
                "sourceStartMs": None,
                "sourceEndMs": None,
                "direction": None,
            }],
        })
        return reference

    def test_review_pack_waits_for_independent_worksheet_completion(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            case = self._base_case(root)
            self._write_reference_and_draft(root, case)
            review = root / case["reviewPackDir"]
            review.mkdir()
            write_json(review / "review-pack.json", {"schema": tool.REVIEW_PACK_SCHEMA})
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
                "IMPORT_AND_RETAIN_TRUTH",
            )

    def test_invalid_completed_worksheet_cannot_advance_to_truth_retention(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            case = self._base_case(root)
            self._write_reference_and_draft(root, case)
            review = root / case["reviewPackDir"]
            review.mkdir()
            write_json(review / "review-pack.json", {"schema": tool.REVIEW_PACK_SCHEMA})
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
            retained = {
                "schema": tool.TRUTH_SCHEMA,
                "status": "RETAINED",
                "referenceId": "reference:fixture",
                "annotationOrigin": "INDEPENDENT_HUMAN",
            }
            write_json(root / case["retainedTruth"], retained)
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


if __name__ == "__main__":
    unittest.main()
