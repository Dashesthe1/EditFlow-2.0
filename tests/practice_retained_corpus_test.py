import hashlib
import importlib.util
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


def load_corpus_tool():
    script = (
        Path(__file__).resolve().parents[1]
        / "scripts"
        / "practice"
        / "practice-retained-corpus.py"
    )
    spec = importlib.util.spec_from_file_location("practice_retained_corpus", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


corpus = load_corpus_tool()
DIFFICULTIES = [
    "FAST_CUTS",
    "NEAR_DUPLICATE_SOURCES",
    "REVERSE_OR_REWIND",
    "IDENTITY_AMBIGUITY",
]


def sha256_bytes(value):
    return hashlib.sha256(value).hexdigest()


class PracticeRetainedCorpusTest(unittest.TestCase):
    def _case_manifest(
        self,
        root,
        index,
        *,
        edit_type_id="edit-type:fixture",
        difficulty=None,
        observation_ready=True,
        finish_bytes=None,
        source_bytes=None,
        declared_finish_sha=None,
    ):
        finish_bytes = finish_bytes or f"finish-{index}".encode("utf-8")
        source_bytes = source_bytes or f"source-{index}".encode("utf-8")
        finish_path = root / f"finish-{index}.mp4"
        source_path = root / f"source-{index}.mp4"
        finish_path.write_bytes(finish_bytes)
        source_path.write_bytes(source_bytes)
        finish_sha = declared_finish_sha or sha256_bytes(finish_bytes)
        source_sha = sha256_bytes(source_bytes)
        case_id = f"case-{index:02d}"
        reference_id = f"reference:{index:02d}"
        difficulty = difficulty or DIFFICULTIES[index % len(DIFFICULTIES)]
        observation_refs = (
            [f"practice-match-observation:sha256:{'c' * 64}:{case_id}"]
            if observation_ready
            else [corpus.PLACEHOLDER_OBSERVATION_REF]
        )
        payload = {
            "schema": corpus.MANIFEST_SCHEMA,
            "editTypeId": edit_type_id,
            "mode": "MEASURE_ONLY",
            "cases": [{
                "finishPath": finish_path.name,
                "sourceMedia": [{
                    "path": source_path.name,
                    "sha256": source_sha,
                }],
                "truth": {
                    "caseId": case_id,
                    "referenceId": reference_id,
                    "finishSha256": finish_sha,
                    "referenceDurationMs": 1000.0,
                    "sourceMediaSha256": [source_sha],
                    "truthAuthority": "INDEPENDENT_HUMAN",
                    "difficultyTags": [difficulty],
                    "shots": [{
                        "shotId": f"shot:{index:02d}:0001",
                        "order": 0,
                        "referenceStartMs": 0.0,
                        "referenceEndMs": 1000.0,
                        "expectedSourceId": f"video:{index:02d}",
                        "expectedSourceStartMs": 1200.0,
                        "expectedSourceEndMs": 2200.0,
                        "expectedDirection": "FORWARD",
                        "truthEvidenceRefs": [
                            f"independent-truth:sha256:{'a' * 64}:shot:{index:02d}"
                        ],
                    }],
                    "evidenceRefs": [
                        f"independent-truth:sha256:{'a' * 64}:{case_id}"
                    ],
                },
                "observation": {
                    "caseId": case_id,
                    "matches": [],
                    "evidenceRefs": observation_refs,
                },
            }],
        }
        manifest_path = root / f"manifest-{index}.json"
        corpus.write_json(manifest_path, payload)
        return manifest_path

    def _twenty_case_paths(self, root, **kwargs):
        return [
            self._case_manifest(root, index, **kwargs)
            for index in range(20)
        ]

    def test_twenty_distinct_cases_can_be_assembled_for_certification_run(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            paths = self._twenty_case_paths(root)
            manifest, inventory = corpus.assemble(paths, "CERTIFICATION")
            self.assertEqual(manifest["mode"], "CERTIFICATION")
            self.assertEqual(len(manifest["cases"]), 20)
            self.assertTrue(inventory["readyForCertificationRun"])
            self.assertEqual(inventory["distinctCaseIdCount"], 20)
            self.assertEqual(inventory["distinctReferenceCount"], 20)
            self.assertEqual(inventory["distinctFinishSha256Count"], 20)
            self.assertEqual(inventory["independentTruthCaseCount"], 20)
            self.assertEqual(inventory["fullLengthTruthCaseCount"], 20)
            self.assertEqual(inventory["observationReadyCaseCount"], 20)
            self.assertGreaterEqual(len(inventory["difficultyKinds"]), 4)

    def test_duplicate_finish_bytes_block_certification_promotion(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            duplicate = b"same-finish-bytes"
            paths = []
            for index in range(20):
                finish_bytes = duplicate if index in (0, 19) else f"finish-{index}".encode()
                paths.append(self._case_manifest(
                    root,
                    index,
                    finish_bytes=finish_bytes,
                ))
            _, inventory = corpus.assemble(paths, "MEASURE_ONLY")
            self.assertFalse(inventory["readyForCertificationRun"])
            self.assertTrue(any(
                "reuses Finish byte identity" in reason
                for reason in inventory["reasons"]
            ))
            with self.assertRaisesRegex(ValueError, "not ready for a certification run"):
                corpus.assemble(paths, "CERTIFICATION")

    def test_placeholder_observation_stays_measure_only(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            paths = [
                self._case_manifest(
                    root,
                    index,
                    observation_ready=index != 7,
                )
                for index in range(20)
            ]
            manifest, inventory = corpus.assemble(paths, "MEASURE_ONLY")
            self.assertEqual(manifest["mode"], "MEASURE_ONLY")
            self.assertFalse(inventory["readyForCertificationRun"])
            self.assertEqual(inventory["observationReadyCaseCount"], 19)
            self.assertTrue(any(
                "observation evidence has not been retained" in reason
                for reason in inventory["reasons"]
            ))

    def test_stale_finish_bytes_are_rejected_before_assembly(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            paths = self._twenty_case_paths(root)
            manifest = corpus.load_json(paths[3])
            finish_path = root / manifest["cases"][0]["finishPath"]
            finish_path.write_bytes(b"changed-after-truth-retention")
            with self.assertRaisesRegex(ValueError, "Finish media bytes do not match"):
                corpus.assemble(paths, "MEASURE_ONLY")

    def test_mixed_edit_types_are_rejected(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            paths = [
                self._case_manifest(
                    root,
                    index,
                    edit_type_id=(
                        "edit-type:other" if index == 19 else "edit-type:fixture"
                    ),
                )
                for index in range(20)
            ]
            with self.assertRaisesRegex(ValueError, "one Edit Type id"):
                corpus.assemble(paths, "MEASURE_ONLY")

    def test_insufficient_difficulty_diversity_blocks_certification(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            paths = [
                self._case_manifest(
                    root,
                    index,
                    difficulty="FAST_CUTS",
                )
                for index in range(20)
            ]
            _, inventory = corpus.assemble(paths, "MEASURE_ONLY")
            self.assertEqual(inventory["difficultyKinds"], ["FAST_CUTS"])
            self.assertTrue(any(
                "fewer than 4 hard-case categories" in reason
                for reason in inventory["reasons"]
            ))
            with self.assertRaisesRegex(ValueError, "not ready for a certification run"):
                corpus.assemble(paths, "CERTIFICATION")


if __name__ == "__main__":
    unittest.main()
