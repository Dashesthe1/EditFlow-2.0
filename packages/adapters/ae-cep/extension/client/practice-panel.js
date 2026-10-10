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
  var activeRunState = null;
  var completedRunId = null;
  var lastRecoveredRunId = null;
  var statusTimer = null;
  var pollTimer = null;
  var editTypesById = {};
  var editTypesSignature = null;
  var editTypesCacheKey = "editflow2.practice.empty-edit-types-cache.v1";
  var pendingEditTypesKey = "editflow2.practice.empty-pending-edit-types.v1";
  var selectedEditTypeKey = "editflow2.practice.selected-edit-type.v1";
  var cachedEditTypes = [];
  var pendingEditTypes = [];
  var pendingEditTypeSync = false;
  var preferredEditTypeId = "";

  var editTypeEl = document.getElementById("edit-type");
  var newEditTypeEl = document.getElementById("new-edit-type");
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
        if (!response.ok) {
          var error = new Error(value.error || "Practice service HTTP " + response.status);
          error.status = response.status;
          throw error;
        }
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

  function readStoredJsonArray(key) {
    try {
      var raw = window.localStorage.getItem(key);
      if (!raw) return [];
      var value = JSON.parse(raw);
      return Array.isArray(value) ? value : [];
    } catch (_) {
      return [];
    }
  }

  function writeStoredJsonArray(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function readStoredString(key) {
    try { return window.localStorage.getItem(key) || ""; } catch (_) { return ""; }
  }

  function writeStoredString(key, value) {
    try {
      if (value) window.localStorage.setItem(key, value);
      else window.localStorage.removeItem(key);
    } catch (_) {}
  }

  function mergeEditTypes(confirmed, pending) {
    var merged = [];
    var seen = {};
    (confirmed || []).forEach(function (profile) {
      if (!profile || !profile.editTypeId || seen[profile.editTypeId]) return;
      seen[profile.editTypeId] = true;
      merged.push(profile);
    });
    (pending || []).forEach(function (profile) {
      if (!profile || !profile.editTypeId || seen[profile.editTypeId]) return;
      seen[profile.editTypeId] = true;
      merged.push(profile);
    });
    return merged;
  }

  function setCachedEditTypes(editTypes) {
    cachedEditTypes = Array.isArray(editTypes) ? editTypes : [];
    writeStoredJsonArray(editTypesCacheKey, cachedEditTypes);
  }

  function setPendingEditTypes(editTypes) {
    pendingEditTypes = Array.isArray(editTypes) ? editTypes : [];
    writeStoredJsonArray(pendingEditTypesKey, pendingEditTypes);
  }

  function reconcilePendingEditTypes(confirmed) {
    var confirmedIds = {};
    (confirmed || []).forEach(function (profile) {
      if (profile && profile.editTypeId) confirmedIds[profile.editTypeId] = true;
    });
    var next = pendingEditTypes.filter(function (profile) {
      return !confirmedIds[profile.editTypeId];
    });
    if (next.length !== pendingEditTypes.length) setPendingEditTypes(next);
  }

  function normalizeCepPath(raw) {
    var value = decodeURI(String(raw || ""));
    if (value.indexOf("file:///") === 0 && /^[A-Za-z]:\//.test(value.substring(8))) value = value.substring(8);
    else if (value.indexOf("file://") === 0) value = value.substring(7);
    return value.replace(/\\/g, "/").replace(/\/+$/, "");
  }

  function editTypeRegistryPath() {
    var cep = window.__adobe_cep__;
    if (!cep || typeof cep.getSystemPath !== "function") return null;
    var userData;
    try { userData = normalizeCepPath(cep.getSystemPath("userData")); }
    catch (_) { return null; }
    var lower = userData.toLowerCase();
    var marker = lower.indexOf("/appdata/roaming");
    if (marker < 0) return null;
    return userData.substring(0, marker) + "/AppData/Local/EditFlow2/practice-state/edit-types.json";
  }

  function readEditTypesFromLocalRegistry() {
    var cepFs = window.cep && window.cep.fs;
    var filePath = editTypeRegistryPath();
    if (!cepFs || typeof cepFs.readFile !== "function" || !filePath) return null;
    try {
      var result = cepFs.readFile(filePath);
      if (!result || result.err !== 0 || typeof result.data !== "string") return null;
      var parsed = JSON.parse(result.data);
      if (!parsed || parsed.schema !== "editflow.edit-type-registry.v1" || !Array.isArray(parsed.profiles)) return null;
      return parsed.profiles;
    } catch (_) {
      return null;
    }
  }

  function selectedEditType() {
    return editTypeEl.value;
  }

  function selectedEditTypeProfile() {
    return editTypesById[selectedEditType()] || null;
  }

  function configurationLocked() {
    return activeRunState === "RUNNING" || activeRunState === "BLOCKED" || activeRunState === "CANCEL_REQUESTED";
  }

  function updateAction() {
    var configLocked = configurationLocked();
    var startBlocked = Boolean(activeRunId);
    editTypeEl.disabled = configLocked;
    newEditTypeEl.disabled = configLocked;
    document.querySelectorAll(".mode-tab").forEach(function (tab) { tab.disabled = configLocked; });
    var hasVideo = startFiles.some(function (item) { return item.kind === "VIDEO"; });
    var valid = serviceReady && !startBlocked
      && selectedEditType() && hasVideo;
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
    var selected = editTypeEl.value || preferredEditTypeId;
    editTypesById = {};
    editTypeEl.innerHTML = '<option value="">Choose an Edit Type</option>';
    editTypes.forEach(function (profile) {
      editTypesById[profile.editTypeId] = profile;
      var option = document.createElement("option");
      option.value = profile.editTypeId;
      var sessions = Array.isArray(profile.sessionIds) ? profile.sessionIds.length : 0;
      var examples = ((profile.gptLearning && profile.gptLearning.workedExamples) || []).length;
      option.textContent = profile.title + " | " + sessions + " sessions | " + examples + " saved examples"
        + (profile.pendingLocal === true ? " | pending sync" : "");
      editTypeEl.appendChild(option);
    });
    if (selected && editTypesById[selected]) {
      editTypeEl.value = selected;
      preferredEditTypeId = selected;
      writeStoredString(selectedEditTypeKey, selected);
    } else {
      editTypeEl.value = "";
    }

    updateAction();
  }

  function editTypesUiSignature(editTypes) {
    return JSON.stringify(editTypes.map(function (profile) {
      return [
        profile.editTypeId,
        profile.title,
        profile.revision || 0,
        (profile.sessionIds || []).length,
        ((profile.gptLearning && profile.gptLearning.workedExamples) || []).length,
        profile.pendingLocal === true
      ];
    }));
  }

  function renderCurrentEditTypes() {
    var editTypes = mergeEditTypes(cachedEditTypes, pendingEditTypes);
    var signature = editTypesUiSignature(editTypes);
    if (signature === editTypesSignature) return;
    editTypesSignature = signature;
    renderEditTypes(editTypes);
  }

  function refreshEditTypesFromLocalRegistry() {
    var localEditTypes = readEditTypesFromLocalRegistry();
    if (localEditTypes === null) return false;
    setCachedEditTypes(localEditTypes);
    reconcilePendingEditTypes(localEditTypes);
    renderCurrentEditTypes();
    return true;
  }

  function refreshEditTypes() {
    refreshEditTypesFromLocalRegistry();
    if (!serviceReady) {
      renderCurrentEditTypes();
      return Promise.resolve();
    }
    return productRequest("/v1/product/edit-types", { method: "GET" })
      .then(function (value) {
        var editTypes = value.editTypes || [];
        setCachedEditTypes(editTypes);
        reconcilePendingEditTypes(editTypes);
        renderCurrentEditTypes();
      });
  }

  function syncPendingEditTypes() {
    if (!serviceReady || configurationLocked() || pendingEditTypeSync || pendingEditTypes.length === 0) {
      return Promise.resolve();
    }
    pendingEditTypeSync = true;
    var queue = pendingEditTypes.slice();
    var chain = Promise.resolve();
    queue.forEach(function (profile) {
      chain = chain.then(function () {
        if (!pendingEditTypes.some(function (item) { return item.editTypeId === profile.editTypeId; })) return;
        return productRequest("/v1/product/edit-types", {
          method: "POST",
          body: JSON.stringify({ editTypeId: profile.editTypeId, title: profile.title })
        }).then(function () {
          setPendingEditTypes(pendingEditTypes.filter(function (item) {
            return item.editTypeId !== profile.editTypeId;
          }));
        }).catch(function (error) {
          if (error && error.status === 409) return;
          if (error && error.status === 400) {
            return productRequest("/v1/product/edit-types", { method: "GET" }).then(function (value) {
              var confirmed = value.editTypes || [];
              if (confirmed.some(function (item) { return item.editTypeId === profile.editTypeId; })) {
                setPendingEditTypes(pendingEditTypes.filter(function (item) {
                  return item.editTypeId !== profile.editTypeId;
                }));
                return;
              }
              throw error;
            });
          }
          throw error;
        });
      });
    });
    return chain.then(function () {
      pendingEditTypeSync = false;
      return refreshEditTypes();
    }).catch(function (error) {
      pendingEditTypeSync = false;
      renderCurrentEditTypes();
      throw error;
    });
  }

  function recoverPanelSession(status) {
    if (status.activeRunId) {
      activeRunState = status.activeRunState || activeRunState || "WAITING_FOR_GPT";
      if (activeRunId !== status.activeRunId) {
        activeRunId = status.activeRunId;
        completedRunId = null;
        lastRecoveredRunId = status.activeRunId;
        setRunState(activeRunState,
          activeRunState === "RUNNING"
            ? "Recovered active EditFlow run after service/panel restart."
            : "Recovered session. Checking its current progress…");
        updateAction();
        pollRun();
      } else {
        updateAction();
      }
      return;
    }
    if (activeRunId) {
      activeRunId = null;
      activeRunState = null;
      updateAction();
    }
    if (!status.latestRunId || lastRecoveredRunId === status.latestRunId) return;
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
    refreshEditTypesFromLocalRegistry();
    productRequest("/v1/product/status", { method: "GET" })
      .then(function (value) {
        var wasReady = serviceReady;
        var wasPanelConnected = panelConnected;
        serviceReady = value.service === "READY";
        panelConnected = value.panelConnected === true;
        if (!value.activeRunId) activeRunState = null;
        if (!wasReady && serviceReady) {
          if (!value.activeRunId && !value.latestRunId) {
            setRunState("IDLE", panelConnected
              ? "Ready. Configure an Edit Type and media, then start when ready."
              : "Choose a Finished edit, raw files and an Edit Type. Practice will match and assemble raw shots.");
          }
          recoverPanelSession(value);
        } else if (!wasPanelConnected && panelConnected && !activeRunId) {
          setRunState("IDLE", "Ready. Configure an Edit Type and media, then start when ready.");
        }
        if (serviceReady) {
          refreshEditTypes().then(function () {
            return syncPendingEditTypes();
          }).catch(function (error) {
            if (!activeRunId) {
              setRunState("IDLE", "Edit Type setup remains available. Background sync will retry: " + error.message);
            }
          });
        }
        updateAction();
      })
      .catch(function () {
        serviceReady = false;
        panelConnected = false;
        refreshEditTypesFromLocalRegistry();
        renderCurrentEditTypes();
        if (!activeRunId) {
          setRunState("OFFLINE", "Runtime is offline. You can still view, choose, or create an Edit Type; starting a session will become available after reconnection.");
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
    activeRunState = null;
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
    setRunState("COMPLETED", run.finalSummary || "Raw source assembly is complete.");
    refreshEditTypes();
  }

  function pollRun() {
    if (!activeRunId) return;
    productRequest("/v1/product/runs/" + encodeURIComponent(activeRunId), { method: "GET" })
      .then(function (value) {
        var run = value.run;
        activeRunState = run.state;
        updateAction();
        if (["SESSION_READY", "RUNNING", "BLOCKED"].indexOf(run.state) >= 0) {
          setRunState(run.state, run.finalSummary || "Checking Source Match progress…");
          pollTimer = setTimeout(pollRun, 2000);
          return;
        }
        finishRun(run);
      }).catch(function (error) {
        setRunState("OFFLINE", "Session saved. Reconnecting to the UI service · " + error.message);
        pollTimer = setTimeout(pollRun, 2000);
      });
  }

  function startSession(sessionMode) {
    var body = {
      editTypeId: selectedEditType(),
      videoPaths: startFiles.filter(function (item) { return item.kind === "VIDEO"; }).map(function (item) { return item.path; }),
      audioPaths: startFiles.filter(function (item) { return item.kind === "AUDIO"; }).map(function (item) { return item.path; })
    };
    if (sessionMode === "PRACTICE") body.finishPath = finishPath;
    metricsEl.hidden = true;
    hideReviewTools();
    actionEl.disabled = true;
    setRunState("STARTING", "Saving your session…");
    productRequest(sessionMode === "PRACTICE" ? "/v1/product/practice" : "/v1/product/pro-creation", {
      method: "POST", body: JSON.stringify(body)
    }).then(function (value) {
      activeRunId = value.run.sessionId;
      activeRunState = value.run.state;
      updateAction();
      setRunState(value.run.state, value.run.finalSummary);
      pollRun();
    }).catch(function (error) {
      setRunState("FAILED", error.message);
      updateAction();
    });
  }

  function startPractice() { startSession("PRACTICE"); }
  function startProCreation() { startSession("PRO_CREATION"); }

  document.querySelectorAll(".mode-tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      if (configurationLocked()) return;
      mode = tab.getAttribute("data-mode");
      document.querySelectorAll(".mode-tab").forEach(function (item) {
        item.classList.toggle("is-active", item === tab);
      });
      finishFieldEl.hidden = mode !== "PRACTICE";
      actionEl.textContent = mode === "PRACTICE" ? "Proceed to do homework" : "Create pro edit";

      metricsEl.hidden = true;
      hideReviewTools();
      setRunState("IDLE", mode === "PRACTICE"
        ? "Choose a Finished edit, raw files and an Edit Type. The Supervisor starts Source Match, then AE raw assembly."
        : "Choose raw files and an Edit Type, then start an empty Pro Creation session.");
      updateAction();
    });
  });

  editTypeEl.addEventListener("change", function () {
    if (activeRunId) return;
    preferredEditTypeId = editTypeEl.value;
    writeStoredString(selectedEditTypeKey, preferredEditTypeId);
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

  newEditTypeEl.addEventListener("click", function () {
    if (configurationLocked()) {
      setRunState("BLOCKED", "Edit Type configuration is locked while an edit session is actively running.");
      return;
    }
    var title = window.prompt("Name this Edit Type");
    if (!title || !title.trim()) return;
    title = title.trim();
    var id = title.toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!id) {
      setRunState("FAILED", "Edit Type name must contain letters or numbers.");
      return;
    }
    var existing = mergeEditTypes(cachedEditTypes, pendingEditTypes).find(function (profile) {
      return profile.editTypeId === id || String(profile.title || "").toLowerCase() === title.toLowerCase();
    });
    if (existing) {
      preferredEditTypeId = existing.editTypeId;
      writeStoredString(selectedEditTypeKey, preferredEditTypeId);
      renderCurrentEditTypes();
      editTypeEl.value = existing.editTypeId;
      setRunState("IDLE", "That Edit Type already exists and is now selected.");
      updateAction();
      return;
    }
    var profile = {
      schema: "editflow.edit-type-profile.v1",
      editTypeId: id,
      title: title,
      choiceWords: [title],
      revision: 0,
      sessionIds: [],
      masteredSessionIds: [],
      behaviorEvidence: [],
      gptLearning: { workedExamples: [] },
      pendingLocal: true
    };
    setPendingEditTypes(pendingEditTypes.concat([profile]));
    preferredEditTypeId = id;
    writeStoredString(selectedEditTypeKey, id);
    renderCurrentEditTypes();
    editTypeEl.value = id;
    setRunState("IDLE", serviceReady
      ? "Edit Type created. Synchronizing it with the EditFlow runtime…"
      : "Edit Type saved locally. It remains selectable offline and will synchronize when the runtime reconnects.");
    updateAction();
    syncPendingEditTypes().then(function () {
      if (!pendingEditTypes.some(function (item) { return item.editTypeId === id; })) {
        setRunState("IDLE", panelConnected
          ? "Edit Type saved and selected. Add media when ready."
          : "Edit Type saved and selected. Add media when ready.");
      }
      updateAction();
    }).catch(function (error) {
      setRunState("IDLE", "Edit Type remains saved locally and selected. Synchronization will retry automatically: " + error.message);
      updateAction();
    });
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
    activeRunState = "CANCEL_REQUESTED";
    cancelEl.disabled = true;
    updateAction();
    setRunState("CANCEL_REQUESTED", "Cancelling the session…");
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
        "Cancelling the session…"
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

  cachedEditTypes = readStoredJsonArray(editTypesCacheKey);
  pendingEditTypes = readStoredJsonArray(pendingEditTypesKey);
  preferredEditTypeId = readStoredString(selectedEditTypeKey);
  refreshEditTypesFromLocalRegistry();
  renderCurrentEditTypes();
  renderFiles();
  checkService();
  statusTimer = setInterval(checkService, 2000);
}());
