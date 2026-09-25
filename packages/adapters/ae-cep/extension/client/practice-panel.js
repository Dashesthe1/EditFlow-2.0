(function () {
  "use strict";

  var config = window.EDITFLOW2_BRIDGE_CONFIG || {};
  var productPort = Number.isInteger(config.productPort) ? config.productPort : config.port + 1;
  var mode = "PRACTICE";
  var serviceReady = false;
  var panelConnected = false;
  var finishPath = null;
  var startFiles = [];
  var activeRunId = null;
  var completedRunId = null;
  var lastRecoveredRunId = null;
  var statusTimer = null;
  var pollTimer = null;
  var editTypesById = {};
  var recertificationActive = false;

  var editTypeEl = document.getElementById("edit-type");
  var practiceRoleFieldEl = document.getElementById("practice-role-field");
  var practiceRoleEl = document.getElementById("practice-role");
  var practiceRoleHintEl = document.getElementById("practice-role-hint");
  var lifecycleMaturityEl = document.getElementById("practice-lifecycle-maturity");
  var lifecycleStepsEl = document.getElementById("practice-lifecycle-steps");
  var lifecycleNextEl = document.getElementById("practice-lifecycle-next");
  var recertifyRobustEl = document.getElementById("practice-recertify-robust");
  var finishFieldEl = document.getElementById("finish-field");
  var finishSummaryEl = document.getElementById("finish-summary");
  var startSummaryEl = document.getElementById("start-summary");
  var startFilesEl = document.getElementById("start-files");
  var actionEl = document.getElementById("primary-action");
  var cancelEl = document.getElementById("cancel-action");
  var runStateEl = document.getElementById("run-state");
  var messageEl = document.getElementById("activity-message");
  var metricsEl = document.getElementById("result-metrics");
  var reviewToolsEl = document.getElementById("review-tools");
  var openBestAttemptEl = document.getElementById("open-best-attempt");
  var humanReviewFormEl = document.getElementById("human-review-form");
  var reviewStatusEl = document.getElementById("review-status");

  function productUrl(path) {
    return "http://127.0.0.1:" + productPort + path;
  }

  function productRequest(path, options) {
    var init = options || {};
    init.headers = {
      "Content-Type": "application/json",
      "X-EditFlow-Token": config.token
    };
    return fetch(productUrl(path), init).then(function (response) {
      return response.text().then(function (text) {
        var value = text ? JSON.parse(text) : {};
        if (!response.ok) throw new Error(value.error || "Practice service HTTP " + response.status);
        return value;
      });
    });
  }

  function basename(filePath) {
    return filePath.replace(/\\/g, "/").split("/").pop() || filePath;
  }

  function mediaKind(filePath) {
    var extension = (filePath.split(".").pop() || "").toLowerCase();
    return ["aac", "aif", "aiff", "flac", "m4a", "mp3", "ogg", "wav"].indexOf(extension) >= 0
      ? "AUDIO"
      : "VIDEO";
  }

  function setRunState(state, message) {
    runStateEl.textContent = state.replace(/_/g, " ");
    runStateEl.setAttribute("data-state", state);
    messageEl.textContent = message;
  }

  function selectedEditType() {
    return editTypeEl.value;
  }

  function selectedPracticeRole() {
    if (!practiceRoleEl) return "AUTO";
    return practiceRoleEl.value || "AUTO";
  }

  function selectedEditTypeMaturity() {
    var option = editTypeEl.options[editTypeEl.selectedIndex];
    return option ? option.getAttribute("data-maturity") || "UNPROVEN" : "UNPROVEN";
  }

  function selectedEditTypeProfile() {
    return editTypesById[selectedEditType()] || null;
  }

  function lifecycleState(profile) {
    var knowledge = profile && profile.knowledge ? profile.knowledge : null;
    var learning = knowledge && knowledge.gptLearning ? knowledge.gptLearning : null;
    var maturity = knowledge && knowledge.maturityStage ? knowledge.maturityStage : "UNPROVEN";
    var progressionGate = knowledge && knowledge.progressionGate ? knowledge.progressionGate : null;
    var referenceCount = knowledge ? Number(knowledge.referenceVerifiedPracticeSessionCount || 0) : 0;
    var transferCount = knowledge ? Number(knowledge.transferVerifiedPracticeSessionCount || 0) : 0;
    var heldOutCases = learning && Array.isArray(learning.heldOutCases) ? learning.heldOutCases : [];
    var heldOutBenchmarks = learning && Array.isArray(learning.heldOutBenchmarks)
      ? learning.heldOutBenchmarks : [];
    var truthReports = learning && Array.isArray(learning.retainedTruthSuiteReports)
      ? learning.retainedTruthSuiteReports : [];
    var latestBenchmark = heldOutBenchmarks.slice().sort(function (left, right) {
      return String(right.evaluatedAt || "").localeCompare(String(left.evaluatedAt || ""));
    })[0] || null;
    var certifiedTruth = truthReports.filter(function (report) { return report.certified === true; })
      .sort(function (left, right) {
        return String(right.evaluatedAt || "").localeCompare(String(left.evaluatedAt || ""));
      })[0] || null;
    var latestTruth = certifiedTruth || truthReports.slice().sort(function (left, right) {
      return String(right.evaluatedAt || "").localeCompare(String(left.evaluatedAt || ""));
    })[0] || null;
    var referenceDone = referenceCount > 0
      || ["VISUAL_MATCH_VERIFIED", "TRANSFER_VERIFIED", "OBJECT_AWARE_VERIFIED", "ROBUST"].indexOf(maturity) >= 0;
    var transferDone = transferCount > 0
      || ["TRANSFER_VERIFIED", "OBJECT_AWARE_VERIFIED", "ROBUST"].indexOf(maturity) >= 0;
    var heldOutDone = maturity === "ROBUST"
      || (latestBenchmark && latestBenchmark.heldOutProofVerified === true);
    var truthDone = maturity === "ROBUST"
      || (progressionGate
        ? progressionGate.retainedTruthCertificationComplete === true
        : certifiedTruth !== null);
    return {
      maturity: maturity,
      progressionGate: progressionGate,
      blockingDependencies: progressionGate && Array.isArray(progressionGate.blockingDependencies)
        ? progressionGate.blockingDependencies
        : [],
      referenceCount: referenceCount,
      transferCount: transferCount,
      heldOutCount: heldOutCases.length,
      truthCaseCount: progressionGate
        ? Number(progressionGate.caseCount || 0)
        : latestTruth ? Number(latestTruth.caseCount || 0) : 0,
      referenceDone: referenceDone,
      transferDone: transferDone,
      heldOutDone: heldOutDone,
      truthDone: truthDone
    };
  }

  function addLifecycleStep(label, state, detail) {
    var item = document.createElement("div");
    item.className = "lifecycle-step";
    item.setAttribute("data-state", state);
    var title = document.createElement("strong");
    title.textContent = label + " · " + (state === "DONE" ? "Done" : state === "NEXT" ? "Next" : "Locked");
    var meta = document.createElement("span");
    meta.textContent = detail;
    item.appendChild(title);
    item.appendChild(meta);
    lifecycleStepsEl.appendChild(item);
  }

  function renderPracticeLifecycle() {
    if (!lifecycleMaturityEl || !lifecycleStepsEl || !lifecycleNextEl) return;
    if (recertifyRobustEl) recertifyRobustEl.hidden = true;
    var profile = selectedEditTypeProfile();
    lifecycleStepsEl.innerHTML = "";
    if (!profile) {
      lifecycleMaturityEl.textContent = "UNPROVEN";
      addLifecycleStep("1 Reference proof", "NEXT", "No machine-passing reference run yet");
      addLifecycleStep("2 Transfer proof", "LOCKED", "Requires reference proof first");
      addLifecycleStep("3 Held-out generalization", "LOCKED", "Requires transfer proof first");
      addLifecycleStep("4 Retained truth authority", "LOCKED", "Requires independent full-length real-media truth");
      lifecycleNextEl.textContent = "Choose an Edit Type to see the next required proof.";
      return;
    }

    var state = lifecycleState(profile);
    var robustAllowed = state.progressionGate
      ? state.progressionGate.robustClaimAllowed === true
      : state.maturity === "ROBUST";
    lifecycleMaturityEl.textContent = state.maturity.replace(/_/g, " ");
    addLifecycleStep(
      "1 Reference proof",
      state.referenceDone ? "DONE" : "NEXT",
      state.referenceCount + " machine-verified session" + (state.referenceCount === 1 ? "" : "s")
    );
    addLifecycleStep(
      "2 Transfer proof",
      state.transferDone ? "DONE" : state.referenceDone ? "NEXT" : "LOCKED",
      state.transferCount + " materially different transfer session" + (state.transferCount === 1 ? "" : "s")
    );
    addLifecycleStep(
      "3 Held-out generalization",
      state.heldOutDone ? "DONE" : state.transferDone ? "NEXT" : "LOCKED",
      state.heldOutCount + " retained held-out case" + (state.heldOutCount === 1 ? "" : "s")
    );
    addLifecycleStep(
      "4 Retained truth authority",
      state.truthDone ? "DONE" : state.heldOutDone ? "NEXT" : "LOCKED",
      state.truthCaseCount + " independently reviewed truth case" + (state.truthCaseCount === 1 ? "" : "s")
    );

    if (!state.referenceDone) {
      lifecycleNextEl.textContent = "Next: reconstruct this Finish from its Start media until the machine reference-proof gate passes.";
    } else if (!state.transferDone) {
      lifecycleNextEl.textContent = "Next: run Practice on materially different Finish and Start media. Reused reference or Start bytes are rejected before transfer promotion.";
    } else if (!state.heldOutDone) {
      lifecycleNextEl.textContent = "Next: AUTO runs held-out generalization on genuinely unseen Finish/Start media. Transfer-verified knowledge stays frozen and failed machine-proven cases remain retained.";
    } else if (!state.truthDone) {
      lifecycleNextEl.textContent = "Next: complete the independent 20-30 case retained real-media truth suite. More held-out edits are not the current blocker.";
    } else if (!robustAllowed) {
      lifecycleNextEl.textContent = "Next: refresh the held-out benchmark against the certified truth authority and current transfer target set. No new edit is required for this refresh.";
      if (recertifyRobustEl) recertifyRobustEl.hidden = mode !== "PRACTICE";
    } else {
      lifecycleNextEl.textContent = "Practice is ROBUST: held-out generalization and independent retained-truth authority are both bound to the current transfer target set.";
    }
  }

  function transferVerifiedReady() {
    return ["TRANSFER_VERIFIED", "OBJECT_AWARE_VERIFIED", "ROBUST"].indexOf(selectedEditTypeMaturity()) >= 0;
  }

  function effectivePracticeRole() {
    var selected = selectedPracticeRole();
    if (selected !== "AUTO") return selected;
    return transferVerifiedReady() ? "HELD_OUT_CERTIFICATION" : "LEARNING";
  }

  function heldOutReady() {
    if (selectedPracticeRole() !== "HELD_OUT_CERTIFICATION") return true;
    return transferVerifiedReady();
  }

  function autoProgressionBlock() {
    if (selectedPracticeRole() !== "AUTO") return null;
    var profile = selectedEditTypeProfile();
    if (!profile) return null;
    var state = lifecycleState(profile);
    if (!state.heldOutDone) return null;
    if (!state.truthDone) return "TRUTH_REQUIRED";
    if (state.progressionGate
      ? state.progressionGate.robustClaimAllowed !== true
      : state.maturity !== "ROBUST") return "BENCHMARK_REFRESH_REQUIRED";
    return "ROBUST_COMPLETE";
  }

  function updatePracticeRoleUi() {
    if (!practiceRoleEl || !practiceRoleHintEl) return;
    var selected = selectedPracticeRole();
    var effective = effectivePracticeRole();
    var heldOut = effective === "HELD_OUT_CERTIFICATION";
    var progressionBlock = autoProgressionBlock();
    if (selected === "AUTO" && progressionBlock === "TRUTH_REQUIRED") {
      practiceRoleHintEl.textContent = "Automatic progression paused: held-out generalization is already verified. Complete the independent retained-truth suite before running more edits.";
    } else if (selected === "AUTO" && progressionBlock === "BENCHMARK_REFRESH_REQUIRED") {
      practiceRoleHintEl.textContent = "Automatic progression paused: retained truth is certified. Refresh the held-out benchmark against the current transfer target set; no new edit is required.";
    } else if (selected === "AUTO" && progressionBlock === "ROBUST_COMPLETE") {
      practiceRoleHintEl.textContent = "Automatic progression complete: this Edit Type is ROBUST. Choose forced held-out certification only when intentionally extending benchmark coverage.";
    } else {
      practiceRoleHintEl.textContent = selected === "AUTO"
        ? (heldOut
          ? "Automatic progression: TRANSFER VERIFIED knowledge is frozen. The next Practice run is held-out generalization on genuinely unseen Finish/Start material."
          : "Automatic progression: continue learning and machine-verifying new reconstructions until a materially different pair promotes this Edit Type to TRANSFER VERIFIED.")
        : heldOut
          ? "Forced certification freezes transfer-verified knowledge: no research, new skills, or retained lessons. Failed machine-proven cases remain in the benchmark."
          : "Forced learning may research, correct, and retain proven lessons under the selected Edit Type.";
    }
    if (mode === "PRACTICE") {
      actionEl.textContent = progressionBlock === "TRUTH_REQUIRED"
        ? "Retained truth required"
        : progressionBlock === "BENCHMARK_REFRESH_REQUIRED"
          ? "Benchmark refresh required"
          : progressionBlock === "ROBUST_COMPLETE"
            ? "Practice ROBUST"
            : heldOut ? "Run held-out certification" : "Proceed to do homework";
    }
  }

  function updateAction() {
    var hasVideo = startFiles.some(function (item) { return item.kind === "VIDEO"; });
    var valid = serviceReady && !activeRunId && !recertificationActive
      && selectedEditType() && hasVideo && panelConnected;
    if (mode === "PRACTICE") {
      valid = valid && Boolean(finishPath) && heldOutReady() && autoProgressionBlock() === null;
    }
    actionEl.disabled = !valid;
    if (recertifyRobustEl) {
      recertifyRobustEl.disabled = !serviceReady || Boolean(activeRunId) || recertificationActive;
    }
    cancelEl.hidden = !activeRunId;
    cancelEl.disabled = !activeRunId;
  }

  function renderFiles() {
    startFilesEl.innerHTML = "";
    startFiles.forEach(function (item, index) {
      var row = document.createElement("div");
      row.className = "file-row";
      var name = document.createElement("span");
      name.textContent = (item.kind === "AUDIO" ? "Audio · " : "Video · ") + basename(item.path);
      name.title = item.path;
      var remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.addEventListener("click", function () {
        startFiles.splice(index, 1);
        renderFiles();
      });
      row.appendChild(name);
      row.appendChild(remove);
      startFilesEl.appendChild(row);
    });
    var videos = startFiles.filter(function (item) { return item.kind === "VIDEO"; }).length;
    var audio = startFiles.length - videos;
    startSummaryEl.textContent = startFiles.length
      ? videos + " video" + (videos === 1 ? "" : "s") + " · " + audio + " audio"
      : "One or more videos, plus optional audio";
    updateAction();
  }

  function chooseFiles(multiple, title, extensions) {
    var cepFs = window.cep && window.cep.fs;
    if (!cepFs || typeof cepFs.showOpenDialog !== "function") {
      setRunState("FAILED", "CEP file picker is unavailable in this panel.");
      return [];
    }
    var result = cepFs.showOpenDialog(multiple, false, title, "", extensions);
    if (!result || result.err !== 0 || !Array.isArray(result.data)) return [];
    return result.data;
  }

  function addStartPaths(paths) {
    paths.forEach(function (filePath) {
      if (!startFiles.some(function (item) { return item.path === filePath; })) {
        startFiles.push({ path: filePath, kind: mediaKind(filePath) });
      }
    });
    renderFiles();
  }

  function bindDropZone(element, onPaths) {
    ["dragenter", "dragover"].forEach(function (name) {
      element.addEventListener(name, function (event) {
        event.preventDefault();
        element.classList.add("is-dragging");
      });
    });
    ["dragleave", "drop"].forEach(function (name) {
      element.addEventListener(name, function (event) {
        event.preventDefault();
        element.classList.remove("is-dragging");
      });
    });
    element.addEventListener("drop", function (event) {
      var files = event.dataTransfer && event.dataTransfer.files;
      var paths = [];
      for (var index = 0; files && index < files.length; index += 1) {
        var file = files[index];
        if (file.path) paths.push(file.path);
      }
      if (paths.length) onPaths(paths);
    });
  }

  function renderEditTypes(editTypes) {
    var selected = editTypeEl.value;
    editTypesById = {};
    editTypeEl.innerHTML = '<option value="">Choose an Edit Type</option>';
    editTypes.forEach(function (profile) {
      editTypesById[profile.editTypeId] = profile;
      var option = document.createElement("option");
      option.value = profile.editTypeId;
      var maturityId = profile.knowledge && profile.knowledge.maturityStage
        ? profile.knowledge.maturityStage
        : "UNPROVEN";
      var maturity = maturityId.replace(/_/g, " ");
      option.setAttribute("data-maturity", maturityId);
      option.textContent = profile.title + " | " + profile.sessionIds.length + " sessions | " + maturity;
      editTypeEl.appendChild(option);
    });
    if (selected) editTypeEl.value = selected;
    renderPracticeLifecycle();
    updatePracticeRoleUi();
    updateAction();
  }

  function refreshEditTypes() {
    return productRequest("/v1/product/edit-types", { method: "GET" })
      .then(function (value) { renderEditTypes(value.editTypes || []); });
  }

  function recoverPanelSession(status) {
    if (status.activeRunId) {
      if (activeRunId !== status.activeRunId) {
        activeRunId = status.activeRunId;
        completedRunId = null;
        lastRecoveredRunId = status.activeRunId;
        setRunState("RUNNING", "Recovered active EditFlow run after service/panel restart.");
        updateAction();
        pollRun();
      }
      return;
    }
    if (!status.latestRunId || lastRecoveredRunId === status.latestRunId || activeRunId) return;
    lastRecoveredRunId = status.latestRunId;
    productRequest(
      "/v1/product/runs/" + encodeURIComponent(status.latestRunId),
      { method: "GET" }
    ).then(function (value) {
      if (!activeRunId && value.run) finishRun(value.run);
    }).catch(function (error) {
      setRunState("FAILED", "Could not restore the latest Practice run: " + error.message);
    });
  }

  function checkService() {
    productRequest("/v1/product/status", { method: "GET" })
      .then(function (value) {
        var wasReady = serviceReady;
        var wasPanelConnected = panelConnected;
        serviceReady = value.service === "READY";
        panelConnected = value.panelConnected === true;
        if (!wasReady && serviceReady) {
          if (!value.activeRunId && !value.latestRunId) {
            setRunState("IDLE", panelConnected
              ? "Ready. Choose a mode, Edit Type, and media."
              : "Service is ready; waiting for the AE panel bridge.");
          }
          refreshEditTypes().catch(function (error) {
            setRunState("FAILED", error.message);
          });
          recoverPanelSession(value);
        } else if (!wasPanelConnected && panelConnected && !activeRunId) {
          setRunState("IDLE", "Ready. Choose a mode, Edit Type, and media.");
        }
        updateAction();
      })
      .catch(function () {
        serviceReady = false;
        panelConnected = false;
        if (!activeRunId) {
          setRunState("OFFLINE", "Practice service is offline. Run scripts/windows/run-practice-panel.ps1.");
        }
        updateAction();
      });
  }

  function hideReviewTools() {
    completedRunId = null;
    reviewToolsEl.hidden = true;
    reviewStatusEl.textContent = "";
  }

  function reviewField(name) {
    return humanReviewFormEl.elements.namedItem(name);
  }

  function showReviewTools(run) {
    var renderRef = run.finalRenderRef
      || (run.result && run.result.bestAttempt ? run.result.bestAttempt.renderRef : null);
    if (!renderRef || run.state !== "COMPLETED") {
      hideReviewTools();
      return;
    }
    completedRunId = run.sessionId;
    reviewToolsEl.hidden = false;
    reviewStatusEl.textContent = "";
    if (run.humanReview) {
      ["sceneFidelity", "timingPacing", "effectsTransitions", "visualFinish", "overall"]
        .forEach(function (name) {
          var field = reviewField(name);
          if (field) field.value = String(run.humanReview[name]);
        });
      var notes = reviewField("notes");
      if (notes) notes.value = run.humanReview.notes || "";
      reviewStatusEl.textContent = "Saved human review loaded.";
    }
  }

  function showMetrics(result) {
    var best = result.bestAttempt;
    var similarity = best ? Math.round(best.report.overallSimilarity * 1000) / 10 + "%" : "—";
    var matches = String(result.matches ? result.matches.length : 0);
    var attempts = String(result.attempts ? result.attempts.length : 0);
    metricsEl.innerHTML =
      '<div class="metric"><strong>' + similarity + '</strong><span>Best similarity</span></div>' +
      '<div class="metric"><strong>' + matches + '</strong><span>Scene matches</span></div>' +
      '<div class="metric"><strong>' + attempts + '</strong><span>Attempts</span></div>';
    metricsEl.hidden = false;
  }

  function finishRun(run) {
    activeRunId = null;
    lastRecoveredRunId = run.sessionId;
    updateAction();
    if (run.state === "FAILED") {
      metricsEl.hidden = true;
      hideReviewTools();
      setRunState("FAILED", run.error || run.finalSummary || "EditFlow run failed.");
      refreshEditTypes();
      return;
    }
    if (run.state === "CANCELLED") {
      metricsEl.hidden = true;
      hideReviewTools();
      setRunState("CANCELLED", run.finalSummary || "Run cancelled.");
      refreshEditTypes();
      return;
    }
    if (run.result) {
      showMetrics(run.result);
    } else {
      metricsEl.hidden = true;
    }
    showReviewTools(run);
    var label = run.mode === "PRACTICE" ? "Practice" : "Pro Creation";
    if (run.mode === "PRACTICE") {
      if (run.masteryScope) {
        setRunState(
          run.masteryScope,
          run.finalSummary || ("Practice certified " + run.masteryScope.replace(/_/g, " ").toLowerCase() + ".")
        );
      } else {
        var reasons = run.masteryReasons && run.masteryReasons.length
          ? " " + run.masteryReasons.join(" ")
          : "";
        setRunState(
          "HUMAN_REVIEW_REQUIRED",
          run.finalSummary || ("Practice completed, but machine mastery proof did not pass." + reasons)
        );
      }
    } else {
      setRunState(
        "COMPLETED",
        run.finalSummary || (label + " completed by GPT.")
      );
    }
    refreshEditTypes();
  }

  function pollRun() {
    if (!activeRunId) return;
    productRequest("/v1/product/runs/" + encodeURIComponent(activeRunId), { method: "GET" })
      .then(function (value) {
        var run = value.run;
        var seconds = Math.max(0, Math.round((Date.now() - Date.parse(run.startedAt)) / 1000));
        if (run.state === "WAITING_FOR_GPT") {
          setRunState(
            "WAITING_FOR_GPT",
            "Assignment queued for GPT. Waiting for GPT to claim the EditFlow session · " + seconds + "s"
          );
          pollTimer = setTimeout(pollRun, 1000);
          return;
        }
        if (run.state === "RUNNING") {
          var stage = run.stage ? " · " + run.stage.replace(/_/g, " ").toLowerCase() : "";
          setRunState(
            "RUNNING",
            "GPT is orchestrating EditFlow Brain, visual analysis, and After Effects" + stage + " · " + seconds + "s"
          );
          pollTimer = setTimeout(pollRun, 1000);
          return;
        }
        if (run.state === "CANCEL_REQUESTED") {
          cancelEl.disabled = true;
          setRunState(
            "CANCEL_REQUESTED",
            "Cancel requested. GPT must stop at the next safe editing checkpoint."
          );
          pollTimer = setTimeout(pollRun, 500);
          return;
        }
        finishRun(run);
      })
      .catch(function (error) {
        activeRunId = null;
        setRunState("FAILED", error.message);
        updateAction();
      });
  }

  function recertifyRobust() {
    var editTypeId = selectedEditType();
    if (!editTypeId || activeRunId || recertificationActive) return;
    recertificationActive = true;
    updateAction();
    setRunState(
      "RECERTIFYING",
      "Re-evaluating retained truth and refreshing the held-out benchmark against current transfer targets…"
    );
    productRequest(
      "/v1/product/edit-types/" + encodeURIComponent(editTypeId) + "/robust-recertification",
      { method: "POST", body: "{}" }
    ).then(function (value) {
      var report = value.recertification || {};
      return refreshEditTypes().then(function () {
        if (report.robustClaimAllowed === true && report.maturityStage === "ROBUST") {
          setRunState(
            "ROBUST",
            "ROBUST recertification passed. Retained truth and held-out generalization are bound to the current transfer target set."
          );
          return;
        }
        var gate = report.progressionGate || {};
        var blockers = Array.isArray(gate.blockingDependencies) ? gate.blockingDependencies : [];
        setRunState(
          "BLOCKED",
          "ROBUST recertification did not pass."
            + (blockers.length ? " " + blockers.join(" ") : "")
        );
      });
    }).catch(function (error) {
      setRunState("BLOCKED", error.message);
    }).then(function () {
      recertificationActive = false;
      updateAction();
    });
  }

  function startPractice() {
    var progressionBlock = autoProgressionBlock();
    if (progressionBlock !== null) {
      var message = progressionBlock === "TRUTH_REQUIRED"
        ? "Held-out generalization is already verified. Complete the retained-truth suite before running more AUTO edits."
        : progressionBlock === "BENCHMARK_REFRESH_REQUIRED"
          ? "Retained truth is certified. Refresh the held-out benchmark; no new AUTO edit is required."
          : "This Edit Type is already ROBUST. Use forced held-out certification only to extend benchmark coverage.";
      setRunState("BLOCKED", message);
      updateAction();
      return;
    }
    var videos = startFiles.filter(function (item) { return item.kind === "VIDEO"; })
      .map(function (item) { return item.path; });
    var audio = startFiles.filter(function (item) { return item.kind === "AUDIO"; })
      .map(function (item) { return item.path; });
    metricsEl.hidden = true;
    hideReviewTools();
    var effectiveRole = effectivePracticeRole();
    setRunState(
      "WAITING_FOR_GPT",
      effectiveRole === "HELD_OUT_CERTIFICATION"
        ? "Validating unseen media and creating a frozen held-out certification assignment…"
        : "Validating media and creating a GPT Practice learning assignment…"
    );
    actionEl.disabled = true;
    productRequest("/v1/product/practice", {
      method: "POST",
      body: JSON.stringify({
        editTypeId: selectedEditType(),
        practiceRole: selectedPracticeRole(),
        finishPath: finishPath,
        videoPaths: videos,
        audioPaths: audio
      })
    }).then(function (value) {
      activeRunId = value.run.sessionId;
      updateAction();
      setRunState(
        "WAITING_FOR_GPT",
        value.run.practiceRole === "HELD_OUT_CERTIFICATION"
          ? "Held-out certification assignment created with frozen transfer-verified knowledge. Waiting for GPT to claim it."
          : "Practice learning assignment created. Waiting for GPT to claim it."
      );
      pollRun();
    }).catch(function (error) {
      setRunState("FAILED", error.message);
      updateAction();
    });
  }

  function startProCreation() {
    var videos = startFiles.filter(function (item) { return item.kind === "VIDEO"; })
      .map(function (item) { return item.path; });
    var audio = startFiles.filter(function (item) { return item.kind === "AUDIO"; })
      .map(function (item) { return item.path; });
    metricsEl.hidden = true;
    hideReviewTools();
    actionEl.disabled = true;
    setRunState(
      "WAITING_FOR_GPT",
      "Loading the Edit Type's mastered Practice knowledge and creating a GPT Pro Creation assignment…"
    );
    productRequest("/v1/product/pro-creation", {
      method: "POST",
      body: JSON.stringify({
        editTypeId: selectedEditType(),
        videoPaths: videos,
        audioPaths: audio
      })
    }).then(function (value) {
      activeRunId = value.run.sessionId;
      updateAction();
      setRunState("WAITING_FOR_GPT", "Pro Creation assignment created. Waiting for GPT to claim it.");
      pollRun();
    }).catch(function (error) {
      setRunState("BLOCKED", error.message);
      updateAction();
    });
  }

  document.querySelectorAll(".mode-tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      if (activeRunId) return;
      mode = tab.getAttribute("data-mode");
      document.querySelectorAll(".mode-tab").forEach(function (item) {
        item.classList.toggle("is-active", item === tab);
      });
      finishFieldEl.hidden = mode !== "PRACTICE";
      practiceRoleFieldEl.hidden = mode !== "PRACTICE";
      actionEl.textContent = mode === "PRACTICE" ? actionEl.textContent : "Create pro edit";
      renderPracticeLifecycle();
      updatePracticeRoleUi();
      metricsEl.hidden = true;
      hideReviewTools();
      setRunState("IDLE", mode === "PRACTICE"
        ? "Choose a finished reference and raw source media. GPT will learn by reconstructing it in After Effects."
        : "Choose raw source media. GPT will create from the selected Edit Type's mastered Practice knowledge.");
      updateAction();
    });
  });

  editTypeEl.addEventListener("change", function () {
    renderPracticeLifecycle();
    updatePracticeRoleUi();
    updateAction();
  });
  practiceRoleEl.addEventListener("change", function () {
    updatePracticeRoleUi();
    if (selectedPracticeRole() === "HELD_OUT_CERTIFICATION" && !heldOutReady()) {
      setRunState("BLOCKED", "Held-out certification requires an Edit Type with TRANSFER VERIFIED Practice knowledge.");
    } else if (!activeRunId && mode === "PRACTICE") {
      setRunState(
        "IDLE",
        effectivePracticeRole() === "HELD_OUT_CERTIFICATION"
          ? "Choose an unseen finished reference and raw source media. This run will use frozen transfer-verified knowledge only."
          : "Choose a finished reference and raw source media. GPT will learn by reconstructing it in After Effects."
      );
    }
    updateAction();
  });
  document.getElementById("choose-finish").addEventListener("click", function () {
    var paths = chooseFiles(false, "Choose finished reference", ["mp4", "mov", "m4v", "avi", "mkv"]);
    if (paths.length) {
      finishPath = paths[0];
      finishSummaryEl.textContent = basename(finishPath);
      finishSummaryEl.title = finishPath;
      updateAction();
    }
  });
  document.getElementById("choose-start").addEventListener("click", function () {
    addStartPaths(chooseFiles(
      true,
      "Choose raw video and audio",
      ["mp4", "mov", "m4v", "avi", "mkv", "wav", "mp3", "m4a", "aac", "aif", "aiff", "flac", "ogg"]
    ));
  });

  bindDropZone(document.getElementById("choose-finish"), function (paths) {
    finishPath = paths[0];
    finishSummaryEl.textContent = basename(finishPath);
    finishSummaryEl.title = finishPath;
    updateAction();
  });
  bindDropZone(document.getElementById("choose-start"), addStartPaths);

  document.getElementById("new-edit-type").addEventListener("click", function () {
    var title = window.prompt("Name this Edit Type");
    if (!title || !title.trim()) return;
    var id = title.trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!id) {
      setRunState("FAILED", "Edit Type name must contain letters or numbers.");
      return;
    }
    productRequest("/v1/product/edit-types", {
      method: "POST",
      body: JSON.stringify({ editTypeId: id, title: title.trim() })
    }).then(function (value) {
      return refreshEditTypes().then(function () {
        editTypeEl.value = value.editType.editTypeId;
        renderPracticeLifecycle();
        updatePracticeRoleUi();
        updateAction();
      });
    }).catch(function (error) { setRunState("FAILED", error.message); });
  });

  actionEl.addEventListener("click", function () {
    if (mode === "PRACTICE") startPractice();
    else startProCreation();
  });

  if (recertifyRobustEl) {
    recertifyRobustEl.addEventListener("click", recertifyRobust);
  }

  openBestAttemptEl.addEventListener("click", function () {
    if (!completedRunId) return;
    openBestAttemptEl.disabled = true;
    reviewStatusEl.textContent = "Opening best-attempt render…";
    productRequest(
      "/v1/product/runs/" + encodeURIComponent(completedRunId) + "/open-best-attempt",
      { method: "POST", body: "{}" }
    ).then(function () {
      reviewStatusEl.textContent = "Best-attempt render opened in the system player.";
    }).catch(function (error) {
      reviewStatusEl.textContent = error.message;
    }).then(function () {
      openBestAttemptEl.disabled = false;
    });
  });

  humanReviewFormEl.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!completedRunId) return;
    var body = {};
    ["sceneFidelity", "timingPacing", "effectsTransitions", "visualFinish", "overall"]
      .forEach(function (name) {
        var field = reviewField(name);
        body[name] = field ? Number(field.value) : 0;
      });
    var notes = reviewField("notes");
    var noteText = notes ? notes.value.trim() : "";
    if (noteText) body.notes = noteText;
    reviewStatusEl.textContent = "Saving diagnostic review…";
    productRequest(
      "/v1/product/runs/" + encodeURIComponent(completedRunId) + "/human-review",
      { method: "POST", body: JSON.stringify(body) }
    ).then(function () {
      reviewStatusEl.textContent = "Review saved. It does not change machine mastery.";
    }).catch(function (error) {
      reviewStatusEl.textContent = error.message;
    });
  });

  cancelEl.addEventListener("click", function () {
    if (!activeRunId) return;
    var runId = activeRunId;
    cancelEl.disabled = true;
    setRunState("CANCEL_REQUESTED", "Requesting a safe stop…");
    productRequest(
      "/v1/product/runs/" + encodeURIComponent(runId) + "/cancel",
      { method: "POST", body: "{}" }
    ).then(function (value) {
      if (value.run.state === "CANCELLED") {
        finishRun(value.run);
        return;
      }
      setRunState(
        "CANCEL_REQUESTED",
        "Cancel requested. GPT will stop at the next safe editing checkpoint."
      );
      pollRun();
    }).catch(function (error) {
      cancelEl.disabled = false;
      setRunState("FAILED", error.message);
    });
  });

  window.addEventListener("beforeunload", function () {
    if (statusTimer) clearInterval(statusTimer);
    if (pollTimer) clearTimeout(pollTimer);
  });

  renderPracticeLifecycle();
  updatePracticeRoleUi();
  renderFiles();
  checkService();
  statusTimer = setInterval(checkService, 2000);
}());
