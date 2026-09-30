(() => {
  "use strict";
  const NOTICE = "Quick heads-up: I'm saving a text transcript of this call using Meet's live captions, just for my notes. It stays on my device; no audio or video is recorded.";
  const input = () => MeetAdapter.chatInput();
  const waitFor = async (predicate, active) => {
    for (let n = 0; n < 30; n++) {
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
        if (!input()) {
          const open = MeetAdapter.chatButton();
          if (!open) throw new Error("Meeting chat is unavailable. Please announce the transcript manually.");
          open.click();
        }
        field = await waitFor(input, active);
        if (field.value.trim()) throw new Error("Chat notice not sent because you have a draft. Please announce the transcript manually.");
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
        setter.call(field, this.message);
        field.dispatchEvent(new Event("input", { bubbles: true }));
        const send = await waitFor(() => {
          const el = MeetAdapter.chatSendButton();
          return el && !el.disabled && el.getAttribute("aria-disabled") !== "true" ? el : null;
        }, active);
        // A user's edit while waiting must never be sent by the extension.
        if (field.value !== this.message) throw new Error("Chat draft changed. Please announce the transcript manually.");
        send.click();
        await waitFor(() => !field.value && document.body.innerText.includes(this.message), active);
      } catch (e) {
        this.warning = e.message;
        // Do not clear user edits, and don't automatically resend an uncertain send.
        if (field?.value === this.message) {
          field.value = ""; field.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
      changed();
    }
  };
})();
