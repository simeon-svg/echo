(() => {
  "use strict";
  const paths = {
    pause: "M6 5h4v14H6zm8 0h4v14h-4z",
    play: "M8 5v14l11-7z",
    stop: "M6 6h12v12H6z",
    history: "M4 4h16v16H4V4zm2 2v12h12V6H6zm2 2h8v2H8V8zm0 4h8v2H8v-2zm0 4h5v1H8v-1z",
    retry: "M17.7 6.3A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.2L13 11h8V3z",
    grip: "M8 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm8 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM8 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm8 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM8 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm8 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  };
  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", paths[name]); svg.append(path); return svg;
  }
  function setButton(button, label, name) {
    if (button.getAttribute("aria-label") === label) return;
    button.setAttribute("aria-label", label); button.title = label;
    button.replaceChildren(icon(name));
  }
  globalThis.createMeetOverlay = () => {
    const host = document.createElement("div"); host.id = "local-meet-transcript";
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `:host {position:fixed;left:20px;bottom:24px;width:202px;z-index:2147483647;max-width:calc(100vw - 16px)}
      * {box-sizing:border-box} section {color:#f1f3f4;background:rgba(32,33,36,.38);backdrop-filter:blur(10px);
        border:1px solid rgba(255,255,255,.16);border-radius:28px;padding:6px 8px;
        font:13px/1.4 "Google Sans",Arial,sans-serif;box-shadow:0 2px 12px #0002;max-width:440px}
      .bar {display:flex;align-items:center;gap:6px} .handle {display:flex;align-items:center;gap:8px;
        cursor:grab;touch-action:none;user-select:none;min-width:0;padding:6px 8px 6px 0;flex:1}
      .handle:active {cursor:grabbing} .handle>svg {width:16px;flex-shrink:0;color:#bdc1c6}
      .dot {width:9px;height:9px;border-radius:50%;background:#9aa0a6;flex-shrink:0}
      [data-state="recording"] .dot {background:#57d68d;box-shadow:0 0 0 3px #57d68d18}
      [data-state="paused"] .dot {background:#fdd663}
      [data-state="stopped"] .dot {background:#9aa0a6}
      [data-state="error"] .dot {background:#f28b82}
      p {position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
      button {display:grid;place-items:center;
        height:36px;width:36px;flex-shrink:0;border:0;border-radius:50%;color:#e8eaed;
        background:rgba(60,64,67,.75);cursor:pointer;padding:8px;transition:background .15s}
      button:hover {background:#5f6368} button:active {background:#73777b}
      button.stop {background:rgba(234,67,53,.9);color:#fff} button.stop:hover {background:#c5221f}
      button:disabled {opacity:.4;cursor:default} svg {width:20px;height:20px;fill:currentColor}
      :focus-visible {outline:2px solid #a8c7fa;outline-offset:3px;border-radius:8px}
      .notifications {position:absolute;bottom:calc(100% + 10px);left:0;width:100%;display:flex;flex-direction:column;gap:8px;max-height:50vh;overflow:auto}
      .notification {display:flex;align-items:flex-start;gap:6px;padding:10px;border-radius:12px;background:rgba(32,33,36,.95);color:#f1f3f4;
        font:12px/1.45 Arial,sans-serif;box-shadow:0 3px 12px #0003;border:1px solid #ffffff25;overflow-wrap:anywhere}
      .notification span {flex:1;min-width:0}.notification button {width:22px;height:22px;padding:0;font-size:18px;background:transparent}
      .notification[data-kind="error"] {border-color:#f28b8266}
      [hidden] {display:none!important}`;
    const panel = document.createElement("section"); panel.setAttribute("aria-label", "Meet transcript controls");
    const bar = document.createElement("div"); bar.className = "bar";
    const handle = document.createElement("div"); handle.className = "handle"; handle.tabIndex = 0;
    handle.setAttribute("role", "button"); handle.setAttribute("aria-label", "Move transcript controls. Drag or use arrow keys.");
    handle.title = "Drag to move · Arrow keys to adjust";
    const dot = document.createElement("span"); dot.className = "dot"; dot.setAttribute("aria-hidden", "true");
    const status = document.createElement("p"); status.setAttribute("role", "status");
    handle.append(icon("grip"), dot, status);
    const toggle = document.createElement("button"), stop = document.createElement("button"), history = document.createElement("button");
    stop.className = "stop"; setButton(stop, "Stop", "stop"); setButton(history, "History", "history");
    const notifications = document.createElement("div"); notifications.className = "notifications";
    notifications.setAttribute("aria-label", "Transcript notifications");
    function notify(message, kind = "info") {
      const toast = document.createElement("div"); toast.className = "notification"; toast.dataset.kind = kind;
      toast.setAttribute("role", kind === "error" ? "alert" : "status");
      const text = document.createElement("span"); text.textContent = message;
      const close = document.createElement("button"); close.textContent = "×";
      close.setAttribute("aria-label", "Dismiss notification");
      const timer = setTimeout(() => toast.remove(), 10000);
      close.addEventListener("click", () => { clearTimeout(timer); toast.remove(); });
      toast.append(text, close); notifications.append(toast);
    }
    bar.append(handle, toggle, stop, history); panel.append(bar); shadow.append(style, notifications, panel);
    document.documentElement.append(host); host.hidden = true;
    function position(x, y) {
      const rect = host.getBoundingClientRect();
      host.style.right = "auto";
      host.style.bottom = "auto";
      host.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
      host.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
    }
    let drag;
    handle.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      const rect = host.getBoundingClientRect();
      drag = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      handle.setPointerCapture(e.pointerId); e.preventDefault();
    });
    handle.addEventListener("pointermove", e => { if (drag) position(e.clientX - drag.x, e.clientY - drag.y); });
    handle.addEventListener("pointerup", () => { drag = null; });
    handle.addEventListener("lostpointercapture", () => { drag = null; });
    handle.addEventListener("keydown", e => {
      const deltas = { ArrowLeft: [-1,0], ArrowRight: [1,0], ArrowUp: [0,-1], ArrowDown: [0,1] };
      if (!deltas[e.key]) return;
      e.preventDefault(); const rect = host.getBoundingClientRect(), step = e.shiftKey ? 40 : 10;
      position(rect.left + deltas[e.key][0] * step, rect.top + deltas[e.key][1] * step);
    });
    window.addEventListener("resize", () => {
      if (!host.hidden) { const rect = host.getBoundingClientRect(); position(rect.left, rect.top); }
    });
    return { host, panel, handle, status, notify, toggle, stop, history, setButton };
  };
})();
