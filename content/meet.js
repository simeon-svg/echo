(() => {
  "use strict";
  const overlay = createMeetOverlay();
  const { host, panel, handle, status, notify, toggle, stop, history, setButton, setProblem } = overlay;
  host.hidden = false;
  status.textContent = "Echo is loading";
  toggle.disabled = true; stop.disabled = true;
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
  let call = null;
  let active = false, missingSince = 0, session = null, parser = null;
  let mode = "waiting", available = false, error = "", busy = false;
  let enableAt = 0, saveTimer, scanTimer;
  let writeQueue = Promise.resolve();
  let pendingWrites = 0, savingCaptions = false, captionsDirty = false;
  let durableId = null;
  let detectionProblem = "";
  async function send(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || "Extension connection lost");
    return response.value;
  }
  function render() {
    const text = detectionProblem ? "Transcript unavailable — Meet could not be detected"
      : error ? "Transcript unavailable — local save failed"
      : mode === "stopped" ? (session ? "Transcript stopped" : "Ready to record — start manually")
      : mode === "paused" ? "Transcript paused"
      : !available ? "Transcript unavailable — captions could not be detected"
      : "Transcript recording";
    if (status.textContent !== text) status.textContent = text;
    handle.title = `${text} · Drag to move`;
    handle.setAttribute("aria-label", `${text}. Drag or use arrow keys to move.`);
    setProblem?.(detectionProblem || (error ? "Your transcript could not be saved. Reload Echo and this Meet tab, then try again." : "") || notice.warning ||
      (active && !available && !["paused", "stopped"].includes(mode) ?
        (!meet.captionButton() ? "Echo cannot find the captions button. Try turning on captions in Meet yourself."
          : "Waiting for captions. Make sure captions are turned on in Meet.") : ""));
    panel.dataset.state = detectionProblem || error ? "error" : mode === "paused" ? "paused" : mode === "stopped" ? "stopped"
      : available && mode === "recording" ? "recording" : "waiting";
    const label = mode === "stopped" ? (error ? "Retry Save" : "Start recording segment") : mode === "paused" ? "Resume" : "Pause";
    setButton(toggle, label, mode === "stopped" ? (error ? "retry" : "play") : mode === "paused" ? "play" : "pause");
    toggle.disabled = !!detectionProblem || !active || busy || mode === "waiting" || (!!error && mode !== "stopped");
    stop.disabled = busy || !active || !session || !["recording", "paused"].includes(mode);
  }
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!session) return Promise.resolve();
    const snapshot = structuredClone(session);
    pendingWrites++;
    writeQueue = writeQueue.catch(() => {}).then(async () => {
      await send({ type: durableId === snapshot.id ? "save" : "create", session: snapshot });
      durableId = snapshot.id;
    });
    return writeQueue.then(() => { error = ""; render(); }, e => { error = e.message; render(); throw e; })
      .finally(() => { pendingWrites--; });
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
    call ||= await send({ type: "beginCall" });
    if (!active) return;
    parser = new MeetCaptionParser();
    // Start New Transcript must never import the previous transcript's visible row.
    const restarting = !!session || mode === "stopped";
    if (restarting) parser.boundary(rows());
    const startTime = Date.now();
    const date = new Date(startTime).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    let name = document.title.replace(/^Meet\s*[-–—]\s*/i, "").trim();
    if (/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i.test(name) || /^(Google )?Meet$/i.test(name)) name = "";
    session = { id: crypto.randomUUID(), token: crypto.randomUUID(), ...call,
      title: name ? `${name} — ${date}` : `${date} at ${new Date(startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
      date: new Date(startTime).toISOString(), startTime, endTime: null, duration: 0,
      participants: [], blocks: [], status: "recording" };
    mode = "recording"; error = "";
    await persist(); capture(); render();
    notify("Transcript recording started. Saved locally on this device.");
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
    session.duration = session.endTime - session.startTime; session.reason = reason;
    render();
    await persist();
  }
  async function action(work) {
    busy = true; render();
    try { await work(); } catch (e) { error = e.message; }
    finally { busy = false; render(); }
  }
  toggle.addEventListener("click", () => action(async () => {
    if (mode === "stopped") {
      if (error) { await persist(); return; }
      if (!available) { mode = "waiting"; enableAt = 0; scan(); return; }
      await start();
    }
    else if (mode === "recording") {
      capture(); mode = "paused"; session.status = "paused";
      parser.boundary(rows());
      await persist();
    } else if (mode === "paused") {
      parser.boundary(rows()); enableAt = 0;
      mode = "recording"; session.status = "recording"; scan(); await persist();
    }
  }));
  stop.addEventListener("click", () => action(() => finish()));
  history.addEventListener("click", () => send({ type: "history" }).catch(e => { error = e.message; render(); }));
  function scanPage() {
    const inCall = meet.isInCall();
    if (!inCall) {
      available = false;
      detectionProblem = "Join a meeting to start recording. If you have already joined, reload this tab so Echo can reconnect.";
      if (active) {
        missingSince ||= Date.now();
        if (Date.now() - missingSince > 2500) {
          active = false; finish("meeting ended").catch(() => {});
          notice = new MeetChatNotice();
          firstRecordingStarted = false;
          call = null;
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
      session = null;
      mode = settings.autoStart ? "waiting" : "stopped";
    }
    if (host.hidden) host.hidden = false;
    available = meet.captionsEnabled() && !!meet.captionRegion();
    const visibleRows = available ? rows() : [];
    if (visibleRows.some(row => row.text.trim() && !row.speaker.trim())) available = false;
    const enable = meet.captionButton() && !meet.captionsEnabled();
    if (enable && ["waiting", "recording"].includes(mode) && Date.now() - enableAt > 5000) {
      enableAt = Date.now(); meet.setCaptionsEnabled(true);
    }
    if (available && mode === "waiting" && !busy) action(start);
    capture(visibleRows); render();
  }
  function scan() {
    try { scanPage(); } catch (e) {
      available = false;
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
    if (session && !pendingWrites && ["recording", "paused"].includes(mode)) persist().catch(() => {});
  }, 15000);
  scan();
  })().catch(e => {
    host.hidden = false; panel.dataset.state = "error";
    status.textContent = "Echo could not start";
    handle.title = "Echo could not start. Reload the extension and this Meet tab.";
    toggle.disabled = true; stop.disabled = true;
    setProblem?.("Echo could not start. Reload the extension and this Meet tab, then try again.");
  });
})();
