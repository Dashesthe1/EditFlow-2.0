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

    def test_missing_reference_analysis_is_reported_as_next_action(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            case = self._base_case(root)
            status = tool.build_status(self._plan(root, [case]))
            self.assertEqual(status["cases"][0]["stage"], "REFERENCE_ANALYSIS")
            self.assertEqual(status["cases"][0]["nextAction"], "ANALYZE_REFERENCE")
            self.assertFalse(status["cases"][0]["readyForCorpus"])
            self.assertFalse(status["populationWindowReached"])

    def test_twenty_candidate_window_is_separate_from_case_readiness(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            cases = [self._base_case(root, index) for index in range(20)]
            status = tool.build_status(self._plan(root, cases))
            self.assertTrue(status["populationWindowReached"])
            self.assertEqual(status["candidateCaseCount"], 20)
            self.assertEqual(status["readyForCorpusCount"], 0)
            self.assertEqual(status["stageCounts"], {"REFERENCE_ANALYSIS": 20})

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
