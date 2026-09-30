(() => {
  "use strict";
  const paths = {
    pause: "M6 5h4v14H6zm8 0h4v14h-4z",
    play: "M8 5v14l11-7z",
    stop: "M6 6h12v12H6z",
    history: "M4 4h16v16H4V4zm2 2v12h12V6H6zm2 2h8v2H8V8zm0 4h8v2H8v-2zm0 4h5v1H8v-1z",
    retry: "M17.7 6.3A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.2L13 11h8V3z",
    bell: "M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6v-5a6 6 0 0 0-5-5.9V4a1 1 0 0 0-2 0v1.1A6 6 0 0 0 6 11v5l-2 2v1h16v-1z",
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
    style.textContent = `:host {position:fixed;left:20px;bottom:24px;width:215px;height:48px;z-index:2147483647;max-width:calc(100vw - 16px)}
      * {box-sizing:border-box} section {display:flex;flex-direction:column;position:absolute;bottom:0;left:0;width:100%;color:#f1f3f4;background:rgba(32,33,36,.38);backdrop-filter:blur(10px);
        border:0;border-radius:28px;padding:6px 8px;
        font:13px/1.4 "Google Sans",Arial,sans-serif;box-shadow:0 2px 12px #0002;max-width:440px}
      :host([data-notification-direction="below"]) section {top:0;bottom:auto}
      :host([data-notification-direction="below"]) .bar {order:-1}
      :host([data-notification-direction="below"]) .notifications {padding-top:6px;padding-bottom:0}
      .bar {display:flex;align-items:center;gap:6px} .handle {display:flex;align-items:center;gap:6px;
        cursor:grab;touch-action:none;user-select:none;min-width:0;padding:6px 0;flex:0 0 auto}
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
      button:not(:disabled):hover {background:#5f6368} button:not(:disabled):active {background:#73777b}
      button.stop {background:rgba(234,67,53,.9);color:#fff} button.stop:not(:disabled):hover {background:#c5221f}
      button:disabled {opacity:.4;cursor:default} svg {width:20px;height:20px;fill:currentColor}
      :focus-visible {outline:2px solid #a8c7fa;outline-offset:3px;border-radius:8px}
      .notifications {display:flex;flex-direction:column;gap:6px;padding-bottom:6px;max-height:var(--notification-space,calc(100vh - 88px));overflow:auto}
      .notification-header {display:flex;align-items:center;justify-content:space-between;padding:4px 8px;color:#f1f3f4;font:12px/1.4 Arial,sans-serif;background:transparent}
      .notification-header button {margin-right:-6px;width:22px;height:22px;padding:0;font-size:18px;background:transparent}
      .notification-toggle {position:relative}.badge {position:absolute;top:-3px;right:-3px;min-width:16px;height:16px;padding:0 3px;border-radius:8px;background:#a8c7fa;color:#202124;font:10px/16px Arial,sans-serif;text-align:center}
      .notification-empty {padding:4px 8px 8px;color:#bdc1c6;font:12px/1.4 Arial,sans-serif}
      .notification {padding:8px;border-radius:12px;background:transparent;color:#f1f3f4;
        font:12px/1.45 Arial,sans-serif;border:0;overflow-wrap:anywhere}
      .notification button {float:right;margin:-2px -2px 2px 6px;width:22px;height:22px;padding:0;font-size:18px;background:transparent}
      .notification[data-kind="info"] {background:rgba(40,55,75,.38)}
      .notification[data-kind="success"] {background:rgba(36,64,48,.38)}
      .notification[data-kind="warning"] {background:rgba(75,60,34,.38)}
      .notification[data-kind="error"] {background:rgba(75,40,40,.38)}
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
    setButton(toggle, "Start recording", "play");
    stop.className = "stop"; setButton(stop, "Stop", "stop"); setButton(history, "History", "history");
    const notificationToggle = document.createElement("button"); notificationToggle.className = "notification-toggle";
    notificationToggle.append(icon("bell")); notificationToggle.hidden = false;
    notificationToggle.setAttribute("aria-controls", "echo-notifications");
    notificationToggle.setAttribute("aria-expanded", "false");
    const badge = document.createElement("span"); badge.className = "badge"; badge.setAttribute("aria-hidden", "true");
    notificationToggle.append(badge);
    const notifications = document.createElement("div"); notifications.className = "notifications";
    notifications.id = "echo-notifications"; notifications.hidden = true;
    notifications.setAttribute("aria-label", "Transcript notifications");
    const messageHeader = document.createElement("div"); messageHeader.className = "notification-header";
    const heading = document.createElement("span"); heading.textContent = "Notifications";
    const closePanel = document.createElement("button"); closePanel.textContent = "×";
    closePanel.setAttribute("aria-label", "Close notifications"); closePanel.title = "Close notifications";
    messageHeader.append(heading, closePanel); notifications.append(messageHeader);
    const empty = document.createElement("div"); empty.className = "notification-empty";
    empty.textContent = "No notifications"; notifications.append(empty);
    const messages = new Map();
    function updateNotifications() {
      const count = messages.size;
      badge.hidden = count === 0; empty.hidden = count > 0;
      badge.textContent = String(count);
      notificationToggle.setAttribute("aria-label", `${count} notification${count === 1 ? "" : "s"}`);
      notificationToggle.title = `${count} notification${count === 1 ? "" : "s"}`;
      notificationToggle.setAttribute("aria-expanded", String(!notifications.hidden));
    }
    notificationToggle.addEventListener("click", () => {
      notifications.hidden = !notifications.hidden;
      updateNotifications();
    });
    closePanel.addEventListener("click", () => {
      notifications.hidden = true; updateNotifications(); notificationToggle.focus?.();
    });
    document.addEventListener("click", event => {
      // Clicks inside the closed shadow root include its host in the event path.
      if (!notifications.hidden && !event.composedPath().includes(host)) {
        notifications.hidden = true; updateNotifications();
      }
    }, true);
    host.addEventListener("keydown", event => {
      if (event.key === "Escape" && !notifications.hidden) {
        notifications.hidden = true; updateNotifications(); notificationToggle.focus?.();
      }
    });
    function notify(message, kind = "info") {
      if (messages.has(message)) return messages.get(message);
      const toast = document.createElement("div"); toast.className = "notification"; toast.dataset.kind = kind;
      const text = document.createElement("span"); text.textContent = message;
      const close = document.createElement("button"); close.textContent = "×";
      close.setAttribute("aria-label", "Dismiss notification");
      const dismiss = () => {
        if (messages.get(message) !== dismiss) return;
        toast.remove(); messages.delete(message);
        if (!messages.size) { notifications.hidden = true; notificationToggle.focus?.(); }
        updateNotifications();
      };
      messages.set(message, dismiss);
      close.addEventListener("click", dismiss);
      toast.append(close, text); notifications.append(toast);
      updateNotifications();
      return dismiss;
    }
    let currentProblem = "", dismissProblem;
    function setProblem(message) {
      // Polling the same condition must not reopen a message the user dismissed.
      // Clearing/changing the condition starts a new occurrence.
      if (message === currentProblem) return;
      dismissProblem?.();
      currentProblem = message;
      dismissProblem = message ? notify(message, "error") : undefined;
    }
    bar.append(handle, toggle, stop, history, notificationToggle); panel.append(notifications, bar); shadow.append(style, panel);
    updateNotifications();
    document.documentElement.append(host); host.hidden = false;
    // Store distances from the nearest edges, independently of viewport clamping.
    // A temporarily smaller window must not overwrite the user's placement.
    let placement = { horizontal: "left", vertical: "bottom", x: 20, y: 24 };
    function applyPlacement() {
      const rect = host.getBoundingClientRect();
      const x = placement.horizontal === "left" ? placement.x : innerWidth - rect.width - placement.x;
      const y = placement.vertical === "top" ? placement.y : innerHeight - rect.height - placement.y;
      const left = Math.max(8, Math.min(x, innerWidth - rect.width - 8));
      const top = Math.max(8, Math.min(y, innerHeight - rect.height - 8));
      host.style.right = "auto"; host.style.bottom = "auto";
      host.style.left = `${left}px`; host.style.top = `${top}px`;
      const above = Math.max(0, top - 8);
      const below = Math.max(0, innerHeight - top - rect.height - 8);
      host.dataset.notificationDirection = below > above ? "below" : "above";
      host.style.setProperty("--notification-space", `${Math.max(above, below)}px`);
    }
    function position(x, y, snap = false) {
      const rect = host.getBoundingClientRect();
      x = Math.max(8, Math.min(x, innerWidth - rect.width - 8));
      y = Math.max(8, Math.min(y, innerHeight - rect.height - 8));
      const right = innerWidth - rect.width - x;
      const bottom = innerHeight - rect.height - y;
      const horizontal = x <= right ? "left" : "right";
      const vertical = y <= bottom ? "top" : "bottom";
      const corner = snap && Math.min(x, right) <= 44 && Math.min(y, bottom) <= 44;
      placement = { horizontal, vertical,
        x: corner ? 20 : Math.min(x, right), y: corner ? 20 : Math.min(y, bottom) };
      applyPlacement();
    }
    let drag;
    handle.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      const rect = host.getBoundingClientRect();
      drag = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      handle.setPointerCapture(e.pointerId); e.preventDefault();
    });
    handle.addEventListener("pointermove", e => { if (drag) position(e.clientX - drag.x, e.clientY - drag.y, true); });
    handle.addEventListener("pointerup", () => { drag = null; });
    handle.addEventListener("lostpointercapture", () => { drag = null; });
    handle.addEventListener("keydown", e => {
      const deltas = { ArrowLeft: [-1,0], ArrowRight: [1,0], ArrowUp: [0,-1], ArrowDown: [0,1] };
      if (!deltas[e.key]) return;
      e.preventDefault(); const rect = host.getBoundingClientRect(), step = e.shiftKey ? 40 : 10;
      position(rect.left + deltas[e.key][0] * step, rect.top + deltas[e.key][1] * step);
    });
    window.addEventListener("resize", () => {
      if (!host.hidden) applyPlacement();
    });
    return { host, panel, handle, status, notify, toggle, stop, history, setButton, setProblem, notificationToggle };
  };
})();
