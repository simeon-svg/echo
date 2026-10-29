(() => {
  "use strict";
  const diagnostics = createMeetDiagnostics();
  const overlay = createMeetOverlay();
  const { host, panel, handle, status, notify, toggle, history, setButton, setProblem } = overlay;
  overlay.diagnostics.addEventListener("click", () => {
    try { diagnostics.download(); }
    catch { notify("The diagnostic report could not be downloaded. Try again.", "error"); }
  });
  host.hidden = false;
  status.textContent = "Echo is loading";
  toggle.disabled = true;
  return (async () => {
  const DEFAULT_ANNOUNCE_MESSAGE = "Quick heads-up: I'm saving a text transcript of this call using Meet's live captions, just for my notes. It stays on my device; no audio or video is recorded.";
  const settings = await chrome.storage.local.get({ autoStart: true, announceRecording: true, announceMessage: DEFAULT_ANNOUNCE_MESSAGE });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const key of ["autoStart", "announceRecording"]) {
      if (changes[key]) settings[key] = changes[key].newValue ?? true;
    }
    if (changes.announceMessage) settings.announceMessage = changes.announceMessage.newValue || DEFAULT_ANNOUNCE_MESSAGE;
  });
  const meet = MeetAdapter;
  const rows = () => meet.captionRows();
  let notice = new MeetChatNotice();
  let firstRecordingStarted = false;
  let meetingId = null;
  let active = false, missingSince = 0, session = null, parser = null;
  let mode = "stopped", available = false, error = "", busy = false;
  let enableAt = 0, lastEnableStep = null, saveTimer, scanTimer;
  let writeQueue = Promise.resolve();
  let pendingWrites = 0, savingCaptions = false, captionsDirty = false;
  let durableId = null, finalizedId = null;
  let interruptedMessage = "";
  let detectionProblem = "", visibleRowCount = 0, lastNoticeWarning = "";
  async function send(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw Object.assign(new Error(response?.error || "Extension connection lost"), { code: response?.code });
    return response.value;
  }
  function render() {
    diagnostics.update({ mode, active, available, busy, pendingWrites,
      blocks: session?.blocks.length || 0, captionRows: visibleRowCount,
      detectionProblem, saveError: error, chatWarning: notice.warning,
      autoStart: settings.autoStart, announceRecording: settings.announceRecording });
    if (notice.warning && notice.warning !== lastNoticeWarning) diagnostics.failure("chat", new Error(notice.warning));
    lastNoticeWarning = notice.warning;
    const text = detectionProblem ? "Transcript unavailable — Meet could not be detected"
      : error ? "Transcript unavailable — local save failed"
      : mode === "stopped" ? (session ? "Transcript stopped" : "Ready to record — start manually")
      : !available ? "Transcript unavailable — captions could not be detected"
      : "Transcript recording";
    if (status.textContent !== text) status.textContent = text;
    handle.title = `${text} · Drag to move`;
    handle.setAttribute("aria-label", `${text}. Drag or use arrow keys to move.`);
    setProblem?.(detectionProblem || interruptedMessage || (error ? "Your transcript could not be saved. Reload Echo and this Meet tab, then try again." : "") || notice.warning ||
      (active && !available && mode !== "stopped" ?
        (!meet.captionButton() ? "Echo cannot find the captions button. Try turning on captions in Meet yourself."
          : "Waiting for captions. Make sure captions are turned on in Meet.") : ""));
    panel.dataset.state = detectionProblem || error ? "error" : mode === "stopped" ? "stopped"
      : available && mode === "recording" ? "recording" : "waiting";
    const recording = mode === "recording" || mode === "waiting";
    const retry = mode === "stopped" && !!error;
    setButton(toggle, retry ? "Retry Save" : recording ? "Stop recording" : "Start recording",
      retry ? "retry" : recording ? "stop" : "play");
    toggle.dataset.recording = String(recording);
    // A recording can always be stopped even if Meet detection or saving fails.
    if (overlay.bookmark) overlay.bookmark.disabled = busy || !active || mode !== "recording" || !!error;
    toggle.disabled = busy || !active || (!!detectionProblem && !recording);
  }
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!session) return Promise.resolve();
    const snapshot = structuredClone(session);
    pendingWrites++;
    writeQueue = writeQueue.catch(() => {}).then(async () => {
      if (snapshot.id === finalizedId) return;
      await send({ type: durableId === snapshot.id ? "save" : "create", session: snapshot });
      durableId = snapshot.id;
      diagnostics.saved();
    }).finally(() => { pendingWrites--; });
    return writeQueue.then(() => { error = ""; render(); }, e => {
      diagnostics.failure("save", e);
      if (e.code === "SESSION_FINALIZED") {
        if (session?.id === snapshot.id && finalizedId !== snapshot.id) {
          finalizedId = snapshot.id; mode = "stopped"; error = "";
          captionsDirty = false; clearTimeout(saveTimer); saveTimer = null;
          interruptedMessage = "Recording was interrupted. The saved transcript is kept. Click Start recording to continue in a new transcript.";
          notify(interruptedMessage, "error");
        }
      } else error = e.message;
      render(); throw e;
    });
  }
  function scheduleSave() {
    captionsDirty = true;
    if (saveTimer || savingCaptions) return;
    saveTimer = setTimeout(() => {
      saveTimer = null; captionsDirty = false; savingCaptions = true;
      persist().catch(() => {}).finally(() => {
        savingCaptions = false;
        // Slow storage must not accumulate a queue of full transcript snapshots.
        if (captionsDirty && mode === "recording") scheduleSave();
      });
    }, 350);
  }
  function updateCaptionGap() {
    if (!session || mode !== "recording") return;
    const gap = session.gaps?.at(-1);
    if (!available && !(gap?.kind === "captions" && gap.endTime == null)) {
      (session.gaps ||= []).push({ kind: "captions", timestamp: Date.now(), endTime: null });
      parser?.boundary([]); scheduleSave();
    } else if (available && gap?.kind === "captions" && gap.endTime == null) {
      gap.endTime = Date.now(); parser?.boundary(rows()); scheduleSave();
    }
  }
  function capture(visibleRows) {
    if (mode !== "recording" || !available || !parser || error) return;
    if (parser.update(visibleRows || rows())) {
      session.blocks = parser.blocks;
      session.participants = [...new Set(parser.blocks.map(b => b.speaker))];
      scheduleSave();
    }
  }
  async function start() {
    if (!active || !available) return;
    const call = await send({ type: "beginCall" });
    if (!active) return;
    parser = new MeetCaptionParser();
    // Start New Transcript must never import the previous transcript's visible row.
    const restarting = !!session || mode === "stopped";
    if (restarting) parser.boundary(rows());
    const startTime = Date.now();
    const date = new Date(startTime).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    let name = document.title.replace(/^Meet\s*[-–—]\s*/i, "").trim();
    if (/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i.test(name) || /^(Google )?Meet$/i.test(name)) name = "";
    session = { id: crypto.randomUUID(), token: crypto.randomUUID(), ...call, meetingId: meetingId ||= crypto.randomUUID(),
      title: name ? `${name} — ${date}` : `${date} at ${new Date(startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
      date: new Date(startTime).toISOString(), startTime, endTime: null, duration: 0,
      participants: [], blocks: [], gaps: [], status: "recording" };
    mode = "recording"; error = "";
    await persist(); interruptedMessage = ""; capture(); render();
    if (!firstRecordingStarted) {
      firstRecordingStarted = true;
      const currentNotice = new MeetChatNotice(settings.announceMessage);
      notice = currentNotice;
      if (settings.announceRecording) currentNotice.send(() => active && notice === currentNotice && settings.announceRecording, render);
    }
  }
  async function finish(reason = "stopped") {
    if (!session || mode === "stopped") return;
    capture();
    mode = "stopped";
    session.status = "completed"; session.endTime = Date.now();
    const gap = session.gaps?.at(-1);
    if (gap && gap.endTime == null) gap.endTime = session.endTime;
    session.duration = session.endTime - session.startTime; session.reason = reason;
    render();
    await persist();
  }
  async function action(work) {
    busy = true; render();
    try { await work(); } catch (e) { diagnostics.failure("action", e); if (e.code !== "SESSION_FINALIZED") error = e.message; }
    finally { busy = false; render(); }
  }
  toggle.addEventListener("click", () => {
    if (busy || toggle.disabled) return;
    return action(async () => {
      if (mode === "recording") {
        await finish();
      } else if (mode === "waiting") {
        mode = "stopped";
      } else if (mode === "stopped") {
        if (error) { await persist(); return; }
        if (!available) { mode = "waiting"; enableAt = 0; lastEnableStep = null; scan(); return; }
        await start();
      }
    });
  });
  overlay.bookmark?.addEventListener("click", event => {
    if (overlay.resumeNote?.()) return;
    if (!overlay.noteEditor.hidden) { (overlay.noteInput.hidden ? overlay.noteAdd : overlay.noteInput).focus(); return; }
    if (!session || mode !== "recording") return;
    const timestamp = Date.now();
    return action(async () => {
      capture();
      const segmentId = session.id, token = session.token;
      const blockId = session.blocks.at(-1)?.id ?? null;
      await persist();
      const note = await send({ type: "bookmarkAdd", segmentId, token, blockId, timestamp });
      overlay.showBookmark(text => send({ type: "bookmarkUpdate", segmentId, token, bookmarkId: note.id, commentId: note.commentId, text }));
    });
  });
  history.addEventListener("click", () => send({ type: "history" }).catch(e => { diagnostics.failure("history", e); error = e.message; render(); }));
  function scanPage() {
    const inCall = meet.isInCall();
    if (!inCall) {
      visibleRowCount = 0;
      available = false;
      detectionProblem = "Join a meeting to start recording. If you have already joined, reload this tab so Echo can reconnect.";
      updateCaptionGap();
      if (active) {
        missingSince ||= Date.now();
        if (Date.now() - missingSince > 2500) {
          active = false; finish("meeting ended").catch(() => {});
          notice = new MeetChatNotice();
          firstRecordingStarted = false;
          meetingId = null;
        }
      }
      if (host.hidden) host.hidden = false;
      render();
      return;
    }
    detectionProblem = "";
    missingSince = 0;
    if (!active) {
      active = true;
      session = null; interruptedMessage = "";
      mode = settings.autoStart ? "waiting" : "stopped";
    }
    if (host.hidden) host.hidden = false;
    available = meet.captionsEnabled() && !!meet.captionRegion();
    const visibleRows = available ? rows() : [];
    visibleRowCount = visibleRows.length;
    if (visibleRows.some(row => row.text.trim() && !row.speaker.trim())) available = false;
    const captionControl = meet.captionButton();
    const enable = captionControl && !meet.captionsEnabled();
    const enableStep = captionControl?.getAttribute("aria-haspopup") === "dialog" ? "menu" : "toggle";
    // Opening the menu and enabling live captions are different actions.
    // Take the second step as soon as Meet renders it, retaining the cooldown
    // for repeated attempts on the same step (including failed toggles).
    const nextStep = lastEnableStep === "menu" && enableStep === "toggle";
    if (enable && ["waiting", "recording"].includes(mode) && (nextStep || Date.now() - enableAt > 5000)) {
      if (meet.setCaptionsEnabled(true)) {
        enableAt = Date.now(); lastEnableStep = enableStep;
      }
    }
    if (available && mode === "waiting" && !busy) action(start);
    updateCaptionGap(); capture(visibleRows); render();
  }
  function scan() {
    try { scanPage(); } catch (e) {
      diagnostics.failure("scan", e); visibleRowCount = 0;
      available = false;
      updateCaptionGap();
      detectionProblem = "Echo cannot read this meeting right now. Reload the Meet tab and try again.";
      render();
    }
  }
  new MutationObserver(() => {
    if (!scanTimer) scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 100);
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["aria-label", "aria-pressed", "class", "hidden", "style", "jsname", "jscontroller"] });
  document.addEventListener("click", event => {
    if (event.target instanceof Element && meet.isLeaveTarget(event.target)) finish("left meeting").catch(() => {});
  }, true);
  window.addEventListener("pagehide", () => {
    if (!session || mode === "stopped") return;
    // Delivery during teardown is best effort; background tab events and durable
    // snapshots cover unloads where this message cannot finish.
    finish("navigation").catch(() => {});
  });
  setInterval(scan, 1000);
  setInterval(() => {
    if (session && !pendingWrites && mode === "recording") persist().catch(() => {});
  }, 15000);
  scan();
  })().catch(e => {
    diagnostics.failure("startup", e); diagnostics.update({ mode: "error" });
    host.hidden = false; panel.dataset.state = "error";
    status.textContent = "Echo could not start";
    handle.title = "Echo could not start. Reload the extension and this Meet tab.";
    toggle.disabled = true;
    setProblem?.("Echo could not start. Reload the extension and this Meet tab, then try again.");
  });
})();
