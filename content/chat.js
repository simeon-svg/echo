(() => {
  "use strict";
  const NOTICE = "Quick heads-up: I'm saving a text transcript of this call using Meet's live captions, just for my notes. It stays on my device; no audio or video is recorded.";
  const input = () => MeetAdapter.chatInput();
  const value = field => field.isContentEditable ? field.textContent || "" : field.value;
  function write(field, text) {
    if (field.isContentEditable) {
      // Native editing lets Google's rich-text composer update its own state.
      field.focus();
      if (document.createRange && document.execCommand) {
        const range = document.createRange();
        range.selectNodeContents(field);
        const selection = window.getSelection();
        selection.removeAllRanges(); selection.addRange(range);
        document.execCommand(text ? "insertText" : "delete", false, text);
      }
      if (value(field) !== text) {
        field.textContent = text;
        field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: text ? "insertText" : "deleteContentBackward", data: text || null }));
      }
    } else {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(field, text);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
  const waitFor = async (predicate, active, attempts = 30) => {
    for (let n = 0; n < attempts; n++) {
      if (!active()) throw new Error("Call ended before the chat notice was sent.");
      const found = predicate(); if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("Chat notice could not be sent. Please let participants know manually.");
  };
  globalThis.MeetChatNotice = class {
    constructor(message = NOTICE) { this.message = message || NOTICE; this.attempted = false; this.warning = ""; }
    async send(active, changed) {
      if (this.attempted) return;
      this.attempted = true; // Never duplicate an uncertain send or send on Resume.
      let field;
      try {
        const embedded = globalThis.MeetEmbeddedChat;
        if (!input() && !embedded?.frame()) {
          const open = MeetAdapter.chatButton();
          if (!open) throw new Error("Meeting chat is unavailable. Please announce the transcript manually.");
          // The composer can appear after the panel has already opened.
          // Clicking again here would close it and make readiness time out.
          if (open.getAttribute("aria-expanded") !== "true") open.click();
        }
        const target = await waitFor(() => {
          const field = input();
          if (field) return { field };
          const frame = embedded?.frame();
          return frame ? { frame } : null;
        }, active, 100);
        if (target.frame) {
          await embedded.send(target.frame, this.message, active);
          changed(); return;
        }
        field = target.field;
        if (value(field).trim()) throw new Error("Chat notice not sent because you have a draft. Please announce the transcript manually.");
        write(field, this.message);
        const send = await waitFor(() => {
          const el = MeetAdapter.chatSendButton();
          return el && !el.disabled && el.getAttribute("aria-disabled") !== "true" ? el : null;
        }, active);
        // A user's edit while waiting must never be sent by the extension.
        if (!active()) throw new Error("Call ended before the chat notice was sent.");
        if (value(field) !== this.message) throw new Error("Chat draft changed. Please announce the transcript manually.");
        send.click();
        await waitFor(() => !value(field) && document.body.innerText.includes(this.message), active);
      } catch (e) {
        this.warning = e.message;
        // Do not clear user edits, and don't automatically resend an uncertain send.
        if (field && value(field) === this.message) write(field, "");
      }
      changed();
    }
  };
})();
