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

  var editTypeEl = document.getElementById("edit-type");
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

  function runConnectionPreflight() {
    return productRequest("/v1/product/preflight", { method: "GET" })
      .then(function (value) {
        var preflight = value.preflight || {};
        if (preflight.status === "READY") return preflight;
        var checks = Array.isArray(preflight.checks) ? preflight.checks : [];
        var failed = checks.filter(function (check) { return check.ready !== true; })
          .map(function (check) { return check.id + ": " + check.detail; });
        throw new Error(
          "CONNECTION_PREFLIGHT_BLOCKED: "
            + (failed.length ? failed.join(" ") : "Full GPT-to-AE connection chain is not ready.")
            + " GPT must use Desktop Commander to repair the failed connection legs, then rerun preflight."
        );
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

  function selectedEditTypeProfile() {
    return editTypesById[selectedEditType()] || null;
  }

  function updateAction() {
    var hasVideo = startFiles.some(function (item) { return item.kind === "VIDEO"; });
    var valid = serviceReady && !activeRunId
      && selectedEditType() && hasVideo && panelConnected;
    if (mode === "PRACTICE") {
      valid = valid && Boolean(finishPath);
    }
    actionEl.disabled = !valid;
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
      option.textContent = profile.title + " | " + profile.sessionIds.length + " sessions | " + ((profile.gptLearning && profile.gptLearning.workedExamples || []).length) + " saved examples";
      editTypeEl.appendChild(option);
    });
    if (selected) editTypeEl.value = selected;

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
    metricsEl.hidden = true;
    showReviewTools(run);
    setRunState("COMPLETED", run.finalSummary || "ChatGPT completed and reviewed the edit.");
    refreshEditTypes();
  }

  function pollRun() {
    if (!activeRunId) return;
    productRequest("/v1/product/runs/" + encodeURIComponent(activeRunId), { method: "GET" })
      .then(function (value) {
        var run = value.run;
        var seconds = Math.max(0, Math.round((Date.now() - Date.parse(run.startedAt)) / 1000));
        if (run.preflight && run.preflight.stage !== "READY"
            && (run.state === "WAITING_FOR_GPT" || run.state === "RUNNING")) {
          var prepared = (run.preflight.completedShotIds || []).length;
          var unresolved = (run.preflight.unresolvedShotIds || []).length;
          setRunState(run.preflight.stage,
            "Practice retained · " + prepared + " clips prepared · " + unresolved + " shots unresolved · "
            + run.preflight.stage.replace(/_/g, " ").toLowerCase()
            + (run.preflight.reasons && run.preflight.reasons.length ? " · " + run.preflight.reasons.join(" ") : ""));
          pollTimer = setTimeout(pollRun, 1000);
          return;
        }
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
            "ChatGPT is directly reviewing footage and executing its edit in After Effects" + stage + " · " + seconds + "s"
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
        setRunState("PAUSED", "Connection interrupted; retained Practice will resume · " + error.message);
        pollTimer = setTimeout(pollRun, 2000);
      });
  }

  function startPractice() {
    var videos = startFiles.filter(function (item) { return item.kind === "VIDEO"; })
      .map(function (item) { return item.path; });
    var audio = startFiles.filter(function (item) { return item.kind === "AUDIO"; })
      .map(function (item) { return item.path; });
    metricsEl.hidden = true;
    hideReviewTools();
    setRunState(
      "PREFLIGHT",
      "Creating a persistent Practice assignment. Analysis and connection checks will resume inside this session…"
    );
    actionEl.disabled = true;
    productRequest("/v1/product/practice", {
        method: "POST",
        body: JSON.stringify({
          editTypeId: selectedEditType(),
          practiceRole: "LEARNING",
          finishPath: finishPath,
          videoPaths: videos,
          audioPaths: audio
        })
      }).then(function (value) {
      activeRunId = value.run.sessionId;
      updateAction();
      setRunState(
        "WAITING_FOR_GPT",
        "Practice learning assignment created. Waiting for GPT to claim it."
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
      "PREFLIGHT",
      "Connection preflight: verifying EditFlow bridge, CEP panel, and live After Effects readback before Pro Creation can start…"
    );
    runConnectionPreflight().then(function () {
      setRunState(
        "WAITING_FOR_GPT",
        "Connection preflight passed. Loading the Edit Type's retained Practice examples and creating a GPT Pro Creation assignment…"
      );
      return productRequest("/v1/product/pro-creation", {
        method: "POST",
        body: JSON.stringify({
          editTypeId: selectedEditType(),
          videoPaths: videos,
          audioPaths: audio
        })
      });
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
      actionEl.textContent = mode === "PRACTICE" ? "Proceed to do homework" : "Create pro edit";

      metricsEl.hidden = true;
      hideReviewTools();
      setRunState("IDLE", mode === "PRACTICE"
        ? "Choose a finished reference and raw source media. GPT will learn by reconstructing it in After Effects."
        : "Choose raw source media. GPT will create from the selected Edit Type's retained Practice examples.");
      updateAction();
    });
  });

  editTypeEl.addEventListener("change", function () {

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

        updateAction();
      });
    }).catch(function (error) { setRunState("FAILED", error.message); });
  });

  actionEl.addEventListener("click", function () {
    if (mode === "PRACTICE") startPractice();
    else startProCreation();
  });

  openBestAttemptEl.addEventListener("click", function () {
    if (!completedRunId) return;
    openBestAttemptEl.disabled = true;
    reviewStatusEl.textContent = "Opening reviewed render…";
    productRequest(
      "/v1/product/runs/" + encodeURIComponent(completedRunId) + "/open-best-attempt",
      { method: "POST", body: "{}" }
    ).then(function () {
      reviewStatusEl.textContent = "Reviewed render opened in the system player.";
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
      reviewStatusEl.textContent = "Review saved as feedback alongside ChatGPT’s final render review.";
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

  renderFiles();
  checkService();
  statusTimer = setInterval(checkService, 2000);
}());
