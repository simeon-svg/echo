/* Phase 1 only: validate these controls and caption DOM in a real test call.
 * No network, storage, recording indicator, or guessed caption extraction.
 * Diagnostic exports contain visible live-region text; use a test meeting.
 */
(() => {
  "use strict";
  const host = document.createElement("div");
  host.id = "local-meet-transcript-probe";
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `:host { position:fixed; top:12px; right:12px; z-index:2147483647; }
    section { max-width:310px; padding:12px; border:1px solid #999; border-radius:8px;
      background:#202124; color:white; font:13px/1.4 system-ui; box-shadow:0 2px 12px #0005; }
    p { margin:0 0 8px; } button { font:inherit; cursor:pointer; padding:4px 8px; }
    small { display:block; margin-top:8px; color:#ddd; }`;
  const panel = document.createElement("section");
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const download = document.createElement("button");
  download.textContent = "Save local DOM diagnostics";
  const hint = document.createElement("small");
  hint.textContent = "Investigation build — no transcript is being recorded.";
  panel.append(status, download, hint);
  root.append(style, panel);
  document.documentElement.append(host);

  const visible = element => element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== "hidden";
  const label = element => element.getAttribute("aria-label") || element.textContent || "";
  const buttons = () => [...document.querySelectorAll('button, [role="button"]')].filter(visible);
  const describe = element => ({
    tag: element.tagName.toLowerCase(),
    attributes: Object.fromEntries([...element.attributes]
      .filter(a => /^(class|role|aria-.+|data-.+|jsname)$/.test(a.name))
      .map(a => [a.name, a.value])),
    text: (element.innerText || "").slice(0, 4000),
  });
  const snapshots = [];
  let lastSnapshot = "";
  let lastEnableAttempt = 0;
  let attempted = false;
  let wasActive = false;

  function inspect() {
    const controls = buttons();
    // English accessible labels are provisional until verified against live Meet.
    const active = controls.some(b => /\bleave call\b/i.test(label(b)));
    if (!active) {
      if (wasActive) attempted = false;
      wasActive = false;
      status.textContent = "Waiting for an active Meet call (English UI).";
      return;
    }
    wasActive = true;
    const enable = controls.find(b => /\bturn on captions\b/i.test(label(b)));
    const enabled = controls.some(b => /\bturn off captions\b/i.test(label(b)));
    if (enable && !attempted && Date.now() - lastEnableAttempt > 5000) {
      attempted = true;
      lastEnableAttempt = Date.now();
      enable.click();
    }
    status.textContent = enabled
      ? "Caption control is on — caption extraction is not yet verified."
      : "Transcript unavailable — captions have not been confirmed.";

    // Capture candidates, not presumed transcript rows. The live DOM determines
    // the eventual speaker/text selectors, rather than treating all alerts as speech.
    const regions = [...document.querySelectorAll('[aria-live], [role="log"], [role="region"]')]
      .filter(visible).map(element => ({
        ...describe(element),
        children: [...element.querySelectorAll("*")].slice(0, 80).map(describe),
      }));
    const serialized = JSON.stringify(regions);
    if (serialized !== lastSnapshot) {
      lastSnapshot = serialized;
      snapshots.push({ at: new Date().toISOString(), regions });
      // A bounded in-memory trace for investigation, not transcript retention.
      if (snapshots.length > 120) snapshots.shift();
    }
  }

  download.addEventListener("click", () => {
    const data = { version: 1, at: new Date().toISOString(),
      controls: buttons().map(describe), snapshots };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)],
      { type: "application/json;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "meet-dom-diagnostics.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
  inspect();
  setInterval(inspect, 500);
})();
