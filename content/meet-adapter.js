(() => {
  "use strict";
  // Observed in Meet's Bulgarian UI on September 30, 2026. These are DOM
  // implementation details, not a Google API contract. Keep them in this file.
  const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const unique = elements => elements.length === 1 ? elements[0] : null;
  const buttons = () => [...document.querySelectorAll('button')].filter(visible);
  const icons = el => [...el.querySelectorAll('.google-symbols.notranslate')].map(icon => icon.textContent.trim());
  function candidates(match, labels) {
    const all = buttons();
    const technical = all.filter(match);
    // Ambiguity must not fall through to a translated label and cause a click.
    if (technical.length) return technical;
    return all.filter(el => labels.includes(el.getAttribute("aria-label")));
  }
  const controls = {
    leave: [el => el.getAttribute("jsname") === "CQylAd" || icons(el).includes("call_end"), ["Leave call"]],
    captions: [el => el.getAttribute("jsname") === "RrG0hf" || icons(el).includes("closed_caption"), ["Turn on captions", "Turn off captions"]],
    chat: [el => el.getAttribute("data-panel-id") === "2" && ["chat", "chat_bubble"].some(icon => icons(el).includes(icon)), ["Chat with everyone"]],
    chatSend: [el => (el.getAttribute("jsname") === "SoqoBf" && icons(el).includes("send")) || el.getAttribute("jsname") === "GBTyxb", ["Send a message", "Send message"]],
  };
  const control = key => unique(candidates(...controls[key]));
  const leaveButton = () => control("leave");
  const captionButton = () => control("captions");
  const chatButton = () => control("chat");
  function regionCandidates() {
    const regions = [...document.querySelectorAll('[role="region"][jscontroller="KPn5nb"]')].filter(visible);
    if (regions.length) return regions;
    // Structural fallback works once the first caption row has appeared.
    const parents = [...new Set([...document.querySelectorAll('.nMcdL')]
      .filter(row => row.querySelector('.NWpY1d') && row.querySelector('.ygicle'))
      .map(row => row.closest('[role="region"]')).filter(visible))];
    if (parents.length) return parents;
    return [...document.querySelectorAll('[role="region"][aria-label="Captions"]')].filter(visible);
  }
  const captionRegion = () => unique(regionCandidates());
  function inputCandidates() {
    const editors = [...document.querySelectorAll('[contenteditable="true"][role="textbox"][jsname="yrriRe"]')].filter(visible);
    const fields = [...document.querySelectorAll('textarea[jsname="YPqjbf"]')].filter(visible);
    return [...editors, ...(fields.length ? fields : [...document.querySelectorAll('textarea[aria-label="Send a message"]')].filter(visible))];
  }
  function captionsEnabled() {
    const button = captionButton();
    if (!button) return false;
    if (button.getAttribute("jsname") === "RrG0hf" || icons(button).includes("closed_caption")) return !!captionRegion();
    // Old English DOMs may lack the observed caption controller.
    const label = button.getAttribute("aria-label");
    if (label === "Turn off captions") return true;
    if (label === "Turn on captions") return false;
    return !!captionRegion();
  }
  function currentUserName() {
    const label = [...document.querySelectorAll('[aria-label]')]
      .map(el => el.getAttribute("aria-label")?.trim())
      .find(value => /^(?:Google )?Account:\s*/i.test(value || ""));
    if (!label) return "You";
    const name = label.replace(/^(?:Google )?Account:\s*/i, "").replace(/\s*\([^)]*\)\s*$/, "").trim();
    return name && !name.includes("@") ? name : "You";
  }
  const ids = new WeakMap();
  let nextId = 0;
  function captionRows() {
    const region = captionRegion();
    if (!region) return [];
    let localName;
    return [...region.querySelectorAll('.nMcdL')].map(row => {
      if (!ids.has(row)) ids.set(row, ++nextId);
      const speaker = row.querySelector('.NWpY1d')?.textContent || "";
      // Keep self identity even when the account name can be resolved.
      const isSelf = ["You", "Вие"].includes(speaker.trim());
      return { id: ids.get(row), isSelf, speaker: isSelf ? (localName ||= currentUserName()) : speaker,
        text: row.querySelector('.ygicle')?.textContent || "" };
    });
  }
  globalThis.MeetAdapter = {
    leaveButton, captionButton, captionRegion, captionsEnabled, captionRows, chatButton,
    isInCall: () => !!leaveButton(),
    isLeaveTarget: target => {
      const button = leaveButton();
      return !!button && target.closest('button') === button;
    },
    setCaptionsEnabled(enabled) {
      const button = captionButton();
      if (!button || captionsEnabled() === enabled || button.disabled || button.getAttribute("aria-disabled") === "true") return false;
      button.click(); return true;
    },
    chatInput: () => unique(inputCandidates()),
    chatSendButton: () => control("chatSend"),
    diagnostics() {
      const summary = list => ({ found: list.length === 1, candidates: list.length });
      return { ...Object.fromEntries(Object.entries(controls).map(([key, definition]) => [key, summary(candidates(...definition))])),
        chatInput: summary(inputCandidates()), captionRegion: summary(regionCandidates()) };
    },
  };
})();
