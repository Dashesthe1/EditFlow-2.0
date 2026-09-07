from pathlib import Path
import re

host_path = Path("packages/adapters/ae-cep/host/editflow_host_render_async.jsx")
host = host_path.read_text(encoding="utf-8")
host = host.replace(
    'var BUILD = "0.1.0-dev.4-renderasync2";',
    'var BUILD = "0.1.0-dev.4-renderasync3";',
)

pattern = re.compile(
    r"    function taskWriteMarker\(status, ok, errorMessage\) \{.*?\n    \}\n    function taskCleanupQueueItem\(\) \{",
    re.S,
)
replacement = """    function taskWriteMarker(status, ok, errorMessage) {
      /* Build the complete payload before opening/truncating the durable marker.
       * The synchronous SCHEDULED writers already prove EditFlow2_JSON is present
       * in the installed host. Reusing that clean-room runtime here avoids a
       * second hand-written serializer at the delayed global execution boundary.
       * If serialization ever fails, the previous durable marker remains intact.
       */
      if (!$.global.EditFlow2_JSON || typeof $.global.EditFlow2_JSON.stringify !== \"function\") {
        throw new Error(\"EditFlow clean-room JSON runtime is unavailable in the async render driver.\");
      }
      var payload = $.global.EditFlow2_JSON.stringify({
        schemaVersion: 1,
        jobId: job.jobId,
        status: status,
        ok: ok,
        outputPath: job.outputPath,
        error: errorMessage || null,
        completedAtMs: taskNowMs(),
        queueItemRemoved: job.queueItemRemoved === true
      });
      var marker = new File(job.completionPath);
      marker.encoding = \"UTF-8\";
      if (!marker.open(\"w\")) throw new Error(\"Unable to open render lifecycle marker: \" + marker.fsName);
      try {
        marker.write(payload);
      } finally {
        marker.close();
      }
    }
    function taskCleanupQueueItem() {"""
host, count = pattern.subn(replacement, host, count=1)
if count != 1:
    raise SystemExit(f"Expected one scheduled marker writer; found {count}.")
host_path.write_text(host, encoding="utf-8")

test_path = Path("tests/cep-async-render-m2.test.mjs")
test_source = test_path.read_text(encoding="utf-8")
old = """  assert.match(driver, /function taskScheduleDrive\\(delayMs\\)/);
  assert.doesNotMatch(driver, /EditFlow2_JSON/);
  assert.doesNotMatch(driver, /\\bnowMs\\(\\)/);"""
new = """  assert.match(driver, /function taskScheduleDrive\\(delayMs\\)/);
  assert.match(driver, /\\$\\.global\\.EditFlow2_JSON\\.stringify/);
  assert.match(driver, /clean-room JSON runtime is unavailable/);
  const markerWriterStart = driver.indexOf(\"function taskWriteMarker(status, ok, errorMessage)\");
  const markerWriterEnd = driver.indexOf(\"function taskCleanupQueueItem()\", markerWriterStart);
  const markerWriter = driver.slice(markerWriterStart, markerWriterEnd);
  assert.ok(markerWriter.indexOf(\"var payload =\") >= 0
    && markerWriter.indexOf(\"var marker = new File\") > markerWriter.indexOf(\"var payload =\"),
    \"scheduled marker payload must be fully serialized before the durable file is opened/truncated\");
  assert.doesNotMatch(driver, /\\bnowMs\\(\\)/);"""
if old not in test_source:
    raise SystemExit("Expected async-driver test seam was not found.")
test_source = test_source.replace(old, new, 1)
test_path.write_text(test_source, encoding="utf-8")
