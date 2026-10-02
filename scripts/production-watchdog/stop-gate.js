(function(root) {
  "use strict";
  const PROTOCOL = 1;
  const STABLE_MS = 1500;

  async function stopAndVerify(driver, options = {}) {
    const requestedAt = driver.now();
    const deadline = requestedAt + (options.timeoutMs || 12000);
    const href = options.expectedHref || driver.observe().href;
    let clickCount = 0, idleSince = null, lastClickAt = -Infinity;
    let alreadyIdle = false;
    while (driver.now() <= deadline) {
      await driver.authorized();
      const sample = driver.observe();
      if (sample.href !== href) throw Error("Old conversation changed during Stop verification");
      if (sample.stopVisible) {
        idleSince = null; alreadyIdle = false;
        if (sample.clickableStop && driver.now() - lastClickAt >= 750) {
          lastClickAt = driver.now();
          if (driver.click()) clickCount++;
        }
      } else if (sample.idleUi) {
        if (idleSince === null) idleSince = driver.now();
        alreadyIdle = clickCount === 0;
        if (driver.now() - idleSince >= STABLE_MS) {
          return { protocol: PROTOCOL, stopped: true, href, requestedAt,
            checkedAt: driver.now(), clickCount, alreadyIdle,
            stopVisible: false, idleUi: true, stableForMs: driver.now() - idleSince };
        }
      } else { idleSince = null; }
      await driver.wait(250);
    }
    return { protocol: PROTOCOL, stopped: false, href, requestedAt,
      checkedAt: driver.now(), clickCount, alreadyIdle: false, reason: "stop_not_confirmed" };
  }

  function validStopProof(proof, expectedHref, now, issuedAt = 0) {
    return !!proof && proof.protocol === PROTOCOL && proof.stopped === true &&
      typeof proof.href === "string" && proof.href === expectedHref &&
      proof.stopVisible === false && proof.idleUi === true &&
      Number.isInteger(proof.clickCount) && proof.clickCount >= 0 &&
      (proof.clickCount > 0 || proof.alreadyIdle === true) &&
      proof.stableForMs >= STABLE_MS && proof.transportQuietMs >= STABLE_MS &&
      proof.activeRequests === 0 && proof.activeStreamRequests === 0 &&
      Number.isFinite(proof.requestedAt) && proof.requestedAt >= issuedAt &&
      Number.isFinite(proof.checkedAt) && proof.checkedAt >= proof.requestedAt &&
      now >= proof.checkedAt && now - proof.checkedAt <= 5000;
  }

  const api = { PROTOCOL, STABLE_MS, stopAndVerify, validStopProof };
  root.EditFlowStopGate = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
