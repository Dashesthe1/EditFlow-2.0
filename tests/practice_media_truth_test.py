import csv
import importlib.util
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


def load_truth_tool():
    script = (
        Path(__file__).resolve().parents[1]
        / "scripts"
        / "practice"
        / "practice-media-truth.py"
    )
    spec = importlib.util.spec_from_file_location("practice_media_truth", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


truth_tool = load_truth_tool()
SOURCE_SHA256 = "a" * 64
CHANGED_SOURCE_SHA256 = "b" * 64
SOURCE_HASHES = {"video:movie": SOURCE_SHA256}


def reference():
    return {
        "schema": truth_tool.REFERENCE_SCHEMA,
        "referenceId": "reference:fixture",
        "styleFingerprint": "fixture-style",
        "sourceSha256": "finish-sha256",
        "analysis": {"analyzerFingerprint": "analyzer-sha256"},
        "shots": [
            {
                "shotId": "shot:0001",
                "referenceStartMs": 0.0,
                "referenceEndMs": 800.0,
            },
            {
                "shotId": "shot:0002",
                "referenceStartMs": 800.0,
                "referenceEndMs": 1500.0,
            },
        ],
    }


class PracticeMediaTruthTest(unittest.TestCase):
    def test_scaffold_never_prefills_matcher_answers(self):
        draft = truth_tool.scaffold(reference(), ["video:movie"], SOURCE_HASHES)
        self.assertEqual(draft["status"], "DRAFT")
        self.assertIsNone(draft["annotationOrigin"])
        self.assertEqual(draft["referenceFingerprint"], "fixture-style")
        self.assertEqual(draft["referenceSourceSha256"], "finish-sha256")
        self.assertEqual(draft["referenceAnalyzerFingerprint"], "analyzer-sha256")
        self.assertEqual(draft["allowedSourceSha256"], SOURCE_HASHES)
        self.assertFalse(draft["policy"]["matcherSuggestionsAllowed"])
        self.assertFalse(draft["policy"]["matcherOutputMayBecomeTruth"])
        self.assertEqual(len(draft["shots"]), 2)
        for row in draft["shots"]:
            self.assertIsNone(row["sourceId"])
            self.assertIsNone(row["sourceStartMs"])
            self.assertIsNone(row["sourceEndMs"])
            self.assertIsNone(row["direction"])

    def test_scaffold_requires_exact_source_sha_bindings(self):
        with self.assertRaisesRegex(ValueError, "exact source-ID set"):
            truth_tool.scaffold(reference(), ["video:movie"], {})
        with self.assertRaisesRegex(ValueError, "64-character"):
            truth_tool.scaffold(
                reference(),
                ["video:movie"],
                {"video:movie": "not-a-sha256"},
            )

    def test_retain_rejects_start_bytes_changed_since_scaffold(self):
        draft = truth_tool.scaffold(reference(), ["video:movie"], SOURCE_HASHES)
        with self.assertRaisesRegex(ValueError, "changed since"):
            truth_tool.retain(
                draft,
                reference(),
                ["video:movie"],
                {"video:movie": CHANGED_SOURCE_SHA256},
                "INDEPENDENT_HUMAN",
            )

    def test_source_sha_cli_bindings_reject_malformed_hashes(self):
        self.assertEqual(
            truth_tool.parse_source_sha256_args([
                "video:movie=" + SOURCE_SHA256,
            ]),
            SOURCE_HASHES,
        )
        with self.assertRaisesRegex(ValueError, "64-character"):
            truth_tool.parse_source_sha256_args([
                "video:movie=not-a-sha256",
            ])

    def test_incomplete_draft_cannot_be_retained(self):
        draft = truth_tool.scaffold(reference(), ["video:movie"], SOURCE_HASHES)
        with self.assertRaisesRegex(ValueError, "Truth cannot be retained"):
            truth_tool.retain(
                draft,
                reference(),
                ["video:movie"],
                SOURCE_HASHES,
                "INDEPENDENT_HUMAN",
            )

    def test_complete_independent_truth_can_be_retained(self):
        draft = truth_tool.scaffold(reference(), ["video:movie"], SOURCE_HASHES)
        draft["shots"][0].update({
            "sourceId": "video:movie",
            "sourceStartMs": 1200.0,
            "sourceEndMs": 2000.0,
            "direction": "FORWARD",
            "toleranceMs": 180.0,
        })
        draft["shots"][1].update({
            "sourceId": "video:movie",
            "sourceStartMs": 6300.0,
            "sourceEndMs": 7000.0,
            "direction": "REVERSE",
            "toleranceMs": 200.0,
        })
        retained = truth_tool.retain(
            draft,
            reference(),
            ["video:movie"],
            SOURCE_HASHES,
            "INDEPENDENT_HUMAN",
        )
        self.assertEqual(retained["status"], "RETAINED")
        self.assertEqual(retained["annotationOrigin"], "INDEPENDENT_HUMAN")
        self.assertEqual(retained["allowedSourceSha256"], SOURCE_HASHES)
        self.assertTrue(retained["retainedAt"])
        self.assertEqual(
            truth_tool.validate_truth(
                retained,
                reference(),
                ["video:movie"],
                allowed_source_sha256_by_id=SOURCE_HASHES,
                require_retained=True,
            ),
            [],
        )

    def test_matcher_origin_is_not_an_allowed_retention_origin(self):
        draft = truth_tool.scaffold(reference(), ["video:movie"], SOURCE_HASHES)
        for row in draft["shots"]:
            row.update({
                "sourceId": "video:movie",
                "sourceStartMs": 1000.0,
                "sourceEndMs": 1600.0,
                "direction": "FORWARD",
            })
        draft["status"] = "RETAINED"
        draft["annotationOrigin"] = "EDITFLOW_MATCHER"
        errors = truth_tool.validate_truth(
            draft,
            reference(),
            ["video:movie"],
            require_retained=True,
        )
        self.assertTrue(any("independent" in item.lower() for item in errors))

    def test_wrong_source_id_is_rejected(self):
        draft = truth_tool.scaffold(reference(), ["video:movie"], SOURCE_HASHES)
        for row in draft["shots"]:
            row.update({
                "sourceId": "video:wrong",
                "sourceStartMs": 1000.0,
                "sourceEndMs": 1600.0,
                "direction": "FORWARD",
            })
        draft["status"] = "RETAINED"
        draft["annotationOrigin"] = "INDEPENDENT_EXTERNAL_TOOL"
        errors = truth_tool.validate_truth(
            draft,
            reference(),
            ["video:movie"],
            require_retained=True,
        )
        self.assertTrue(any("sourceId" in item for item in errors))

    def test_retained_truth_is_bound_to_exact_finish_analysis(self):
        draft = truth_tool.scaffold(reference(), ["video:movie"], SOURCE_HASHES)
        for index, row in enumerate(draft["shots"]):
            row.update({
                "sourceId": "video:movie",
                "sourceStartMs": 1000.0 + (index * 1000.0),
                "sourceEndMs": 1600.0 + (index * 1000.0),
                "direction": "FORWARD",
            })
        retained = truth_tool.retain(
            draft,
            reference(),
            ["video:movie"],
            SOURCE_HASHES,
            "INDEPENDENT_HUMAN",
        )
        changed = reference()
        changed["styleFingerprint"] = "changed-style"
        changed["sourceSha256"] = "changed-finish-sha256"
        errors = truth_tool.validate_truth(
            retained,
            changed,
            ["video:movie"],
            require_retained=True,
        )
        self.assertTrue(any("referenceFingerprint" in item for item in errors))
        self.assertTrue(any("referenceSourceSha256" in item for item in errors))

    def test_retained_truth_is_bound_to_exact_start_media_bytes(self):
        draft = truth_tool.scaffold(reference(), ["video:movie"], SOURCE_HASHES)
        for index, row in enumerate(draft["shots"]):
            row.update({
                "sourceId": "video:movie",
                "sourceStartMs": 1000.0 + (index * 1000.0),
                "sourceEndMs": 1600.0 + (index * 1000.0),
                "direction": "FORWARD",
            })
        retained = truth_tool.retain(
            draft,
            reference(),
            ["video:movie"],
            SOURCE_HASHES,
            "INDEPENDENT_HUMAN",
        )
        errors = truth_tool.validate_truth(
            retained,
            reference(),
            ["video:movie"],
            allowed_source_sha256_by_id={
                "video:movie": CHANGED_SOURCE_SHA256,
            },
            require_retained=True,
        )
        self.assertTrue(
            any("exact benchmark Start media bytes" in item for item in errors)
        )

    def test_manifest_source_set_must_match_retained_truth(self):
        draft = truth_tool.scaffold(reference(), ["video:movie"], SOURCE_HASHES)
        for index, row in enumerate(draft["shots"]):
            row.update({
                "sourceId": "video:movie",
                "sourceStartMs": 1000.0 + (index * 1000.0),
                "sourceEndMs": 1600.0 + (index * 1000.0),
                "direction": "FORWARD",
            })
        retained = truth_tool.retain(
            draft,
            reference(),
            ["video:movie"],
            SOURCE_HASHES,
            "INDEPENDENT_HUMAN",
        )
        errors = truth_tool.validate_truth(
            retained,
            reference(),
            ["video:movie", "video:other"],
            require_retained=True,
        )
        self.assertTrue(any("allowedSourceIds" in item for item in errors))

    def test_retained_truth_converts_to_measure_only_suite_without_matcher_leakage(self):
        with TemporaryDirectory() as root:
            root = Path(root)
            finish_path = root / "finish.bin"
            source_path = root / "source.bin"
            finish_path.write_bytes(b"finish-media")
            source_path.write_bytes(b"source-media")
            finish_sha256 = truth_tool.sha256_file(finish_path)
            source_sha256 = truth_tool.sha256_file(source_path)

            ref = reference()
            ref["sourceSha256"] = finish_sha256
            ref["video"] = {"durationMs": 1500.0}
            draft = truth_tool.scaffold(
                ref,
                ["video:movie"],
                {"video:movie": source_sha256},
            )
            draft["shots"][0].update({
                "sourceId": "video:movie",
                "sourceStartMs": 1200.0,
                "sourceEndMs": 2000.0,
                "direction": "FORWARD",
                "toleranceMs": 180.0,
            })
            draft["shots"][1].update({
                "sourceId": "video:movie",
                "sourceStartMs": 6300.0,
                "sourceEndMs": 7000.0,
                "direction": "REVERSE",
            })
            retained = truth_tool.retain(
                draft,
                ref,
                ["video:movie"],
                {"video:movie": source_sha256},
                "INDEPENDENT_HUMAN",
            )
            manifest = truth_tool.build_retained_suite_manifest(
                truth=retained,
                reference=ref,
                finish_path=finish_path,
                source_paths_by_id={"video:movie": str(source_path)},
                case_id="real-case-01",
                edit_type_id="spider-edit",
                difficulty_tags=["FAST_CUTS", "REVERSE_OR_REWIND"],
                truth_evidence_sha256="c" * 64,
                reference_evidence_sha256="d" * 64,
            )

            self.assertEqual(
                manifest["schema"],
                truth_tool.RETAINED_SUITE_MANIFEST_SCHEMA,
            )
            self.assertEqual(manifest["mode"], "MEASURE_ONLY")
            case = manifest["cases"][0]
            self.assertEqual(case["truth"]["truthAuthority"], "INDEPENDENT_HUMAN")
            self.assertEqual(case["truth"]["finishSha256"], finish_sha256)
            self.assertEqual(case["truth"]["sourceMediaSha256"], [source_sha256])
            self.assertEqual(case["truth"]["shots"][1]["expectedDirection"], "REVERSE")
            self.assertEqual(case["observation"]["matches"], [])
            self.assertIn(
                "practice-match-observation:not-yet-generated",
                case["observation"]["evidenceRefs"],
            )

    def test_suite_manifest_rejects_changed_start_bytes(self):
        with TemporaryDirectory() as root:
            root = Path(root)
            finish_path = root / "finish.bin"
            source_path = root / "source.bin"
            finish_path.write_bytes(b"finish-media")
            source_path.write_bytes(b"source-media")
            ref = reference()
            ref["sourceSha256"] = truth_tool.sha256_file(finish_path)
            source_sha256 = truth_tool.sha256_file(source_path)
            draft = truth_tool.scaffold(
                ref,
                ["video:movie"],
                {"video:movie": source_sha256},
            )
            for index, row in enumerate(draft["shots"]):
                row.update({
                    "sourceId": "video:movie",
                    "sourceStartMs": 1000.0 + (index * 1000.0),
                    "sourceEndMs": 1600.0 + (index * 1000.0),
                    "direction": "FORWARD",
                })
            retained = truth_tool.retain(
                draft,
                ref,
                ["video:movie"],
                {"video:movie": source_sha256},
                "INDEPENDENT_HUMAN",
            )
            source_path.write_bytes(b"changed-source-media")
            with self.assertRaisesRegex(ValueError, "Start media bytes"):
                truth_tool.build_retained_suite_manifest(
                    truth=retained,
                    reference=ref,
                    finish_path=finish_path,
                    source_paths_by_id={"video:movie": str(source_path)},
                    case_id="real-case-02",
                    edit_type_id="spider-edit",
                    difficulty_tags=["NEAR_DUPLICATE_SOURCES"],
                    truth_evidence_sha256="c" * 64,
                    reference_evidence_sha256="d" * 64,
                )

    def test_review_pack_stays_matcher_blind_and_imports_independent_annotations(self):
        with TemporaryDirectory() as root:
            root = Path(root)
            finish_path = root / "finish.bin"
            source_path = root / "source.bin"
            finish_path.write_bytes(b"finish-review-media")
            source_path.write_bytes(b"source-review-media")
            ref = reference()
            ref["sourceSha256"] = truth_tool.sha256_file(finish_path)
            source_sha256 = truth_tool.sha256_file(source_path)
            draft = truth_tool.scaffold(
                ref,
                ["video:movie"],
                {"video:movie": source_sha256},
            )

            def fake_preview_writer(_video_path, time_ms, output_path):
                Path(output_path).write_bytes(
                    ("preview:" + str(round(float(time_ms), 3))).encode("utf-8")
                )

            pack_dir = root / "review-pack"
            pack = truth_tool.build_review_pack(
                reference=ref,
                draft=draft,
                finish_path=finish_path,
                source_paths_by_id={"video:movie": str(source_path)},
                output_dir=pack_dir,
                preview_writer=fake_preview_writer,
            )
            self.assertEqual(pack["schema"], truth_tool.REVIEW_PACK_SCHEMA)
            self.assertFalse(pack["policy"]["matcherSuggestionsAllowed"])
            self.assertFalse(pack["policy"]["matcherOutputMayBecomeTruth"])
            self.assertEqual(len(pack["previews"]), 2)
            self.assertEqual(
                len(list((pack_dir / "finish-previews").glob("*.png"))),
                6,
            )

            worksheet_path = pack_dir / "annotations.csv"
            with worksheet_path.open("r", encoding="utf-8", newline="") as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual([item["sourceId"] for item in rows], ["", ""])
            rows[0].update({
                "sourceId": "video:movie",
                "sourceStartMs": "1200",
                "sourceEndMs": "2000",
                "direction": "FORWARD",
                "toleranceMs": "180",
                "notes": "Independent manual review.",
            })
            rows[1].update({
                "sourceId": "video:movie",
                "sourceStartMs": "6300",
                "sourceEndMs": "7000",
                "direction": "REVERSE",
                "toleranceMs": "",
                "notes": "",
            })
            with worksheet_path.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=truth_tool.REVIEW_FIELDS)
                writer.writeheader()
                writer.writerows(rows)

            imported = truth_tool.import_review_csv(draft, ref, worksheet_path)
            self.assertEqual(imported["status"], "DRAFT")
            self.assertIsNone(imported["annotationOrigin"])
            self.assertEqual(imported["shots"][0]["sourceStartMs"], 1200.0)
            self.assertEqual(imported["shots"][1]["direction"], "REVERSE")
            retained = truth_tool.retain(
                imported,
                ref,
                ["video:movie"],
                {"video:movie": source_sha256},
                "INDEPENDENT_HUMAN",
            )
            self.assertEqual(retained["status"], "RETAINED")

    def test_review_pack_can_add_matcher_blind_source_atlas(self):
        with TemporaryDirectory() as root:
            root = Path(root)
            finish_path = root / "finish.bin"
            source_path = root / "source.bin"
            finish_path.write_bytes(b"finish-review-media")
            source_path.write_bytes(b"source-review-media")
            ref = reference()
            ref["sourceSha256"] = truth_tool.sha256_file(finish_path)
            source_sha256 = truth_tool.sha256_file(source_path)
            draft = truth_tool.scaffold(
                ref,
                ["video:movie"],
                {"video:movie": source_sha256},
            )

            def fake_preview_writer(_video_path, time_ms, output_path):
                Path(output_path).write_bytes(str(round(float(time_ms), 3)).encode("utf-8"))

            pack_dir = root / "review-pack"
            pack = truth_tool.build_review_pack(
                reference=ref,
                draft=draft,
                finish_path=finish_path,
                source_paths_by_id={"video:movie": str(source_path)},
                output_dir=pack_dir,
                preview_writer=fake_preview_writer,
                source_atlas_interval_ms=120000.0,
                source_atlas_max_frames=3,
                source_preview_writer=fake_preview_writer,
                source_duration_reader=lambda _path: 600000.0,
            )
            self.assertEqual(len(pack["sourceAtlas"]), 1)
            atlas = pack["sourceAtlas"][0]
            self.assertEqual(atlas["sourceId"], "video:movie")
            self.assertEqual(atlas["sampleCount"], 3)
            self.assertEqual(
                [round(item["timeMs"]) for item in atlas["samples"]],
                [100000, 300000, 500000],
            )
            self.assertEqual(
                len(list((pack_dir / "source-atlas" / "video_movie").glob("*.png"))),
                3,
            )
            with (pack_dir / "annotations.csv").open("r", encoding="utf-8", newline="") as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual([item["sourceId"] for item in rows], ["", ""])
            self.assertFalse(pack["policy"]["matcherSuggestionsAllowed"])

    def test_cached_preview_materialization_retries_transient_file_lock(self):
        with TemporaryDirectory() as root:
            root = Path(root)
            cache_path = root / "cache.png"
            output_path = root / "review" / "frame.png"
            cache_path.write_bytes(b"cached-frame")
            original_link = truth_tool.os.link
            calls = []

            def flaky_link(source, target):
                calls.append((str(source), str(target)))
                if len(calls) == 1:
                    raise PermissionError(13, "transient file lock")
                return original_link(source, target)

            truth_tool.os.link = flaky_link
            try:
                truth_tool._materialize_cached_preview(cache_path, output_path)
            finally:
                truth_tool.os.link = original_link

            self.assertEqual(len(calls), 2)
            self.assertEqual(output_path.read_bytes(), b"cached-frame")

    def test_source_atlas_cache_reuses_exact_source_bytes_across_review_packs(self):
        with TemporaryDirectory() as root:
            root = Path(root)
            finish_path = root / "finish.bin"
            source_path = root / "source.bin"
            finish_path.write_bytes(b"finish-cache-media")
            source_path.write_bytes(b"source-cache-media")
            ref = reference()
            ref["sourceSha256"] = truth_tool.sha256_file(finish_path)
            source_sha256 = truth_tool.sha256_file(source_path)
            draft = truth_tool.scaffold(
                ref,
                ["video:movie"],
                {"video:movie": source_sha256},
            )
            source_writes = []

            def fake_finish_writer(_video_path, time_ms, output_path):
                Path(output_path).write_bytes(str(round(float(time_ms), 3)).encode("utf-8"))

            def fake_source_writer(_video_path, time_ms, output_path):
                source_writes.append(float(time_ms))
                Path(output_path).write_bytes(("source:" + str(round(float(time_ms), 3))).encode("utf-8"))

            cache_dir = root / "atlas-cache"
            first_dir = root / "review-first"
            second_dir = root / "review-second"
            common = {
                "reference": ref,
                "draft": draft,
                "finish_path": finish_path,
                "source_paths_by_id": {"video:movie": str(source_path)},
                "preview_writer": fake_finish_writer,
                "source_atlas_interval_ms": 120000.0,
                "source_atlas_max_frames": 3,
                "source_preview_writer": fake_source_writer,
                "source_duration_reader": lambda _path: 600000.0,
                "source_atlas_cache_dir": cache_dir,
            }
            first = truth_tool.build_review_pack(output_dir=first_dir, **common)
            second = truth_tool.build_review_pack(output_dir=second_dir, **common)

            self.assertEqual(len(source_writes), 3)
            self.assertFalse(first["sourceAtlas"][0]["cacheHit"])
            self.assertTrue(second["sourceAtlas"][0]["cacheHit"])
            self.assertEqual(
                first["sourceAtlas"][0]["cacheKey"],
                second["sourceAtlas"][0]["cacheKey"],
            )
            self.assertEqual(
                len(list((first_dir / "source-atlas" / "video_movie").glob("*.png"))),
                3,
            )
            self.assertEqual(
                len(list((second_dir / "source-atlas" / "video_movie").glob("*.png"))),
                3,
            )

    def test_source_hash_cache_reuses_stable_file_and_invalidates_on_change(self):
        with TemporaryDirectory() as root:
            source_path = Path(root) / "source.bin"
            source_path.write_bytes(b"stable-source")
            original_sha256_file = truth_tool.sha256_file
            calls = []

            def counted_sha256_file(path):
                calls.append(str(path))
                return original_sha256_file(path)

            truth_tool._SHA256_FILE_CACHE.clear()
            truth_tool.sha256_file = counted_sha256_file
            try:
                first = truth_tool.sha256_file_cached(source_path)
                second = truth_tool.sha256_file_cached(source_path)
                self.assertEqual(first, second)
                self.assertEqual(len(calls), 1)

                source_path.write_bytes(b"changed-source-with-new-size")
                third = truth_tool.sha256_file_cached(source_path)
                self.assertNotEqual(first, third)
                self.assertEqual(len(calls), 2)
            finally:
                truth_tool.sha256_file = original_sha256_file
                truth_tool._SHA256_FILE_CACHE.clear()

    def test_source_atlas_sampling_is_bounded_and_fail_closed(self):
        times = truth_tool.source_atlas_sample_times(600000.0, 120000.0, 3)
        self.assertEqual([round(item) for item in times], [100000, 300000, 500000])
        with self.assertRaisesRegex(ValueError, "interval"):
            truth_tool.source_atlas_sample_times(600000.0, 0.0, 3)
        with self.assertRaisesRegex(ValueError, "max frame"):
            truth_tool.source_atlas_sample_times(600000.0, 120000.0, 0)

    def test_review_pack_rejects_prefilled_or_changed_start_media(self):
        with TemporaryDirectory() as root:
            root = Path(root)
            finish_path = root / "finish.bin"
            source_path = root / "source.bin"
            finish_path.write_bytes(b"finish-review-media")
            source_path.write_bytes(b"source-review-media")
            ref = reference()
            ref["sourceSha256"] = truth_tool.sha256_file(finish_path)
            source_sha256 = truth_tool.sha256_file(source_path)
            draft = truth_tool.scaffold(
                ref,
                ["video:movie"],
                {"video:movie": source_sha256},
            )
            draft["shots"][0]["sourceId"] = "video:movie"
            with self.assertRaisesRegex(ValueError, "pristine scaffold"):
                truth_tool.build_review_pack(
                    reference=ref,
                    draft=draft,
                    finish_path=finish_path,
                    source_paths_by_id={"video:movie": str(source_path)},
                    output_dir=root / "prefilled",
                    preview_writer=lambda *_args: None,
                )

            fresh = truth_tool.scaffold(
                ref,
                ["video:movie"],
                {"video:movie": source_sha256},
            )
            source_path.write_bytes(b"changed-after-scaffold")
            with self.assertRaisesRegex(ValueError, "Start media bytes"):
                truth_tool.build_review_pack(
                    reference=ref,
                    draft=fresh,
                    finish_path=finish_path,
                    source_paths_by_id={"video:movie": str(source_path)},
                    output_dir=root / "changed",
                    preview_writer=lambda *_args: None,
                )

    def test_preview_capture_retries_with_ascii_alias_for_unicode_finish_path(self):
        with TemporaryDirectory() as root:
            finish = Path(root) / "finish🔥.mp4"
            finish.write_bytes(b"fixture")

            class Capture:
                def __init__(self, opened):
                    self.opened = opened

                def isOpened(self):
                    return self.opened

                def release(self):
                    pass

            class FakeCv2:
                def __init__(self):
                    self.paths = []

                def VideoCapture(self, value):
                    self.paths.append(str(value))
                    return Capture(len(self.paths) > 1)

            fake_cv2 = FakeCv2()
            capture = truth_tool._opencv_preview_capture(finish, fake_cv2)
            self.assertTrue(capture.isOpened())
            self.assertEqual(fake_cv2.paths[0], str(finish.resolve()))
            self.assertTrue(Path(fake_cv2.paths[1]).name.isascii())

    def test_source_interval_must_be_ascending_even_when_direction_is_reverse(self):
        draft = truth_tool.scaffold(reference(), ["video:movie"], SOURCE_HASHES)
        for row in draft["shots"]:
            row.update({
                "sourceId": "video:movie",
                "sourceStartMs": 1600.0,
                "sourceEndMs": 1000.0,
                "direction": "REVERSE",
            })
        with self.assertRaisesRegex(ValueError, "sourceEndMs"):
            truth_tool.retain(
                draft,
                reference(),
                ["video:movie"],
                SOURCE_HASHES,
                "INDEPENDENT_HUMAN",
            )


if __name__ == "__main__":
    unittest.main()
