/* Local, bounded diagnostics. Never retain arbitrary messages, DOM, or session data. */
(() => {
  "use strict";
  const modes = ["loading", "waiting", "recording", "paused", "stopped", "error"];
  const codes = ["startup", "scan", "save", "action", "history", "chat"];
  const errorNames = ["Error", "TypeError", "DOMException", "QuotaExceededError", "InvalidStateError", "AbortError", "NotAllowedError", "SecurityError", "DataCloneError"];
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  globalThis.createMeetDiagnostics = () => {
    const startedAt = new Date().toISOString();
    let version = "unavailable";
    try {
      const installed = chrome.runtime.getManifest().version;
      if (/^\d+(\.\d+){1,3}$/.test(installed)) version = installed;
    } catch { /* Keep the local exporter usable even without a runtime connection. */ }
    const events = [];
    let state = { mode: "loading" }, lastState = "";
    let lastSaveAt = null, saveFailures = 0;
    function append(event) {
      events.push({ at: new Date().toISOString(), ...event });
      if (events.length > 100) events.shift();
    }
    function update(values) {
      state = {
        mode: modes.includes(values.mode) ? values.mode : "error",
        active: !!values.active, captionsAvailable: !!values.available,
        busy: !!values.busy, pendingWrites: count(values.pendingWrites),
        blocks: count(values.blocks), captionRows: count(values.captionRows),
        detectionProblem: !!values.detectionProblem, saveError: !!values.saveError,
        chatWarning: !!values.chatWarning,
        autoStart: typeof values.autoStart === "boolean" ? values.autoStart : null,
        announceRecording: typeof values.announceRecording === "boolean" ? values.announceRecording : null,
      };
      // Counts change frequently; log meaningful state transitions only.
      const transition = JSON.stringify([state.mode, state.active, state.captionsAvailable,
        state.detectionProblem, state.saveError, state.chatWarning]);
      if (transition !== lastState) {
        append({ type: "state", mode: state.mode, active: state.active,
          captionsAvailable: state.captionsAvailable, detectionProblem: state.detectionProblem,
          saveError: state.saveError, chatWarning: state.chatWarning });
        lastState = transition;
      }
    }
    function failure(source, error) {
      if (!codes.includes(source)) return;
      const message = String(error?.message || "");
      const code = /context invalidated|connection lost/i.test(message) ? "extension-disconnected"
        : /finalized after interruption/i.test(message) ? "session-finalized"
        : /no longer exists/i.test(message) ? "session-missing"
        : /Close other Echo pages/i.test(message) ? "database-upgrade-blocked" : "operation-failed";
      const name = errorNames.includes(error?.name) ? error.name : "Error";
      const frames = [...String(error?.stack || "").matchAll(/content\/(meet|meet-adapter|captions|chat|overlay|diagnostics)\.js:(\d+):(\d+)/g)]
        .slice(0, 5).map(([, file, line, column]) => ({ file: `content/${file}.js`, line: Number(line), column: Number(column) }));
      const previous = events.at(-1);
      if (source === "save") saveFailures++;
      if (previous?.type === "error" && previous.source === source && previous.code === code && previous.name === name &&
          JSON.stringify(previous.frames) === JSON.stringify(frames)) {
        previous.count++; previous.lastAt = new Date().toISOString();
      } else append({ type: "error", source, code, name, frames, count: 1 });
    }
    function saved() { lastSaveAt = new Date().toISOString(); }
    function report() {
      let controls = {}, detectionFailed = false;
      try {
        const detected = MeetAdapter.diagnostics();
        for (const key of ["leave", "captions", "chat", "chatInput", "chatSend", "captionRegion"]) {
          controls[key] = { found: !!detected[key]?.found, candidates: count(detected[key]?.candidates) };
        }
      } catch { detectionFailed = true; }
      return {
        schemaVersion: 1, extensionVersion: version,
        generatedAt: new Date().toISOString(), startedAt,
        environment: {
          platform: /Windows/.test(globalThis.navigator?.userAgent || "") ? "Windows"
            : /Android/.test(globalThis.navigator?.userAgent || "") ? "Android"
            : /CrOS/.test(globalThis.navigator?.userAgent || "") ? "ChromeOS"
            : /Macintosh/.test(globalThis.navigator?.userAgent || "") ? "macOS"
            : /Linux/.test(globalThis.navigator?.userAgent || "") ? "Linux" : "unknown",
          chromiumVersion: (globalThis.navigator?.userAgent || "").match(/(?:Chrome|Chromium)\/([\d.]+)/)?.[1] || null,
          language: /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(globalThis.navigator?.language || "") ? navigator.language : null,
          frame: globalThis.window?.top === globalThis.window?.self ? "top-level" : "embedded",
          visibility: ["visible", "hidden"].includes(document.visibilityState) ? document.visibilityState : "unknown",
        },
        state: { ...state, lastSaveAt, saveFailures }, controls, detectionFailed,
        events: events.map(event => ({ ...event, ...(event.frames ? { frames: event.frames.map(frame => ({ ...frame })) } : {}) })),
      };
    }
    function download() {
      const data = report();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url;
      link.download = `echo-diagnostics-${data.generatedAt.replace(/[:.]/g, "-")}.json`;
      document.documentElement.append(link);
      try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
    }
    return { update, failure, saved, report, download };
  };
})();
