(async () => {
  "use strict";
  const settings = await chrome.storage.local.get({ autoStart: true, announceRecording: true });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const key of ["autoStart", "announceRecording"]) {
      if (changes[key]) settings[key] = changes[key].newValue ?? true;
    }
  });
  // Verified in real Meet, September 24, 2026. Update these selectors first.
  const SELECTORS = { region: '[role="region"][aria-label="Captions"]',
    row: '.nMcdL', speaker: '.NWpY1d', text: '.ygicle' };
  const visible = el => el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const controls = () => [...document.querySelectorAll('button[aria-label]')].filter(visible);
  const named = (buttons, name) => buttons.find(b => b.getAttribute("aria-label") === name);
  const ids = new WeakMap();
  let nextId = 0;
  function rows() {
    const region = document.querySelector(SELECTORS.region);
    if (!visible(region)) return [];
    return [...region.querySelectorAll(SELECTORS.row)].map(el => {
      if (!ids.has(el)) ids.set(el, ++nextId);
      return { id: ids.get(el), speaker: el.querySelector(SELECTORS.speaker)?.textContent || "",
        text: el.querySelector(SELECTORS.text)?.textContent || "" };
    });
  }
  const { host, panel, handle, status, notify, toggle, stop, history, setButton } = createMeetOverlay();
  let notice = new MeetChatNotice();
  let firstRecordingStarted = false;
  let call = null;
  let active = false, missingSince = 0, session = null, parser = null;
  let mode = "waiting", available = false, error = "", busy = false;
  let enableAttempts = 0, enableAt = 0, saveTimer, scanTimer;
  let writeQueue = Promise.resolve();
  let durableId = null;
  let lastError = "", lastWarning = "", captionWarning = false;
  async function send(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || "Extension connection lost");
    return response.value;
  }
  function render() {
    const text = error ? "Transcript unavailable — local save failed"
      : mode === "stopped" ? (session ? "Transcript stopped" : "Ready to record — start manually")
      : mode === "paused" ? "Transcript paused"
      : !available ? "Transcript unavailable — captions could not be detected"
      : "Transcript recording";
    if (status.textContent !== text) status.textContent = text;
    handle.title = `${text} · Drag to move`;
    handle.setAttribute("aria-label", `${text}. Drag or use arrow keys to move.`);
    panel.dataset.state = error ? "error" : mode === "paused" ? "paused" : mode === "stopped" ? "stopped"
      : available && mode === "recording" && !parser?.blocked.size ? "recording" : "waiting";
    if (error && error !== lastError) notify(error, "error");
    if (notice.warning && notice.warning !== lastWarning) notify(notice.warning, "error");
    lastError = error; lastWarning = notice.warning;
    const unavailable = active && !available && enableAttempts >= 3 && mode !== "paused" && mode !== "stopped";
    if (unavailable && !captionWarning) notify("Recording unavailable — captions could not be detected.", "error");
    captionWarning = unavailable;
    const label = mode === "stopped" ? (error ? "Retry Save" : "Start recording segment") : mode === "paused" ? "Resume" : "Pause";
    setButton(toggle, label, mode === "stopped" ? (error ? "retry" : "play") : mode === "paused" ? "play" : "pause");
    toggle.disabled = busy || mode === "waiting" || (!!error && mode !== "stopped");
    stop.hidden = mode === "stopped" || mode === "waiting";
    stop.disabled = busy;
  }
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!session) return Promise.resolve();
    const snapshot = structuredClone(session);
    writeQueue = writeQueue.catch(() => {}).then(async () => {
      await send({ type: durableId === snapshot.id ? "save" : "create", session: snapshot });
      durableId = snapshot.id;
    });
    return writeQueue.then(() => { error = ""; render(); }, e => { error = e.message; render(); throw e; });
  }
  function scheduleSave() {
    if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = null; persist().catch(() => {}); }, 350);
  }
  function capture() {
    if (mode !== "recording" || !available || !parser || error) return;
    if (parser.update(rows())) {
      session.blocks = parser.blocks;
      session.participants = [...new Set(parser.blocks.map(b => b.speaker))];
      scheduleSave();
    }
  }
  function freshCaptions() {
    // Reset cumulative rows at privacy boundaries; surviving old rows stay blocked.
    const off = named(controls(), "Turn off captions");
    if (off) { available = false; enableAttempts = 0; enableAt = 0; off.click(); }
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
      title: name ? `${name} — ${date}` : `Google Meet — ${date} — ${new Date(startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
      date: new Date(startTime).toISOString(), startTime, endTime: null, duration: 0,
      participants: [], blocks: [], status: "recording" };
    mode = "recording"; error = "";
    if (restarting) freshCaptions();
    await persist(); capture(); render();
    notify("Transcript recording started. Saved locally on this device.");
    if (!firstRecordingStarted) {
      firstRecordingStarted = true;
      const currentNotice = notice;
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
      if (!available) { mode = "waiting"; enableAttempts = 0; enableAt = 0; scan(); return; }
      await start();
    }
    else if (mode === "recording") {
      capture(); mode = "paused"; session.status = "paused";
      parser.boundary(rows());
      // Disable Meet captions during Pause as well as blocking parser input.
      // This prevents its cumulative row from collecting paused speech.
      const off = named(controls(), "Turn off captions");
      if (off) off.click();
      await persist();
    } else if (mode === "paused") {
      parser.boundary(rows()); freshCaptions(); mode = "recording"; session.status = "recording"; await persist();
    }
  }));
  stop.addEventListener("click", () => action(() => finish()));
  history.addEventListener("click", () => send({ type: "history" }).catch(e => { error = e.message; render(); }));
  function scan() {
    const buttons = controls();
    const inCall = !!named(buttons, "Leave call");
    if (!inCall) {
      if (active) {
        missingSince ||= Date.now();
        if (Date.now() - missingSince > 2500) {
          active = false; finish("meeting ended").catch(() => {});
          enableAttempts = 0;
          notice = new MeetChatNotice();
          firstRecordingStarted = false;
          call = null;
        }
      }
      host.hidden = !session;
      return;
    }
    missingSince = 0;
    if (!active) {
      active = true;
      session = null;
      mode = settings.autoStart ? "waiting" : "stopped";
    }
    host.hidden = false;
    available = !!named(buttons, "Turn off captions") && visible(document.querySelector(SELECTORS.region));
    if (available && rows().some(row => row.text.trim() && !row.speaker.trim())) available = false;
    const enable = named(buttons, "Turn on captions");
    if (enable && ["waiting", "recording"].includes(mode) && enableAttempts < 3 && Date.now() - enableAt > 5000) {
      enableAttempts++; enableAt = Date.now(); enable.click();
    }
    if (available) enableAttempts = 0;
    if (available && mode === "waiting" && !busy) action(start);
    capture(); render();
  }
  new MutationObserver(() => {
    if (!scanTimer) scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 100);
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["aria-label"] });
  document.addEventListener("click", event => {
    if (event.target instanceof Element && event.target.closest('button[aria-label="Leave call"]')) finish("left meeting").catch(() => {});
  }, true);
  window.addEventListener("pagehide", () => {
    if (!session || mode === "stopped") return;
    // Delivery during teardown is best effort; background tab events and durable
    // snapshots cover unloads where this message cannot finish.
    finish("navigation").catch(() => {});
  });
  setInterval(scan, 1000);
  setInterval(() => { if (session && ["recording", "paused"].includes(mode)) persist().catch(() => {}); }, 15000);
  scan();
})();
