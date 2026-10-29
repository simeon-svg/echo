(() => {
  "use strict";
  const channel = "echo-meet-chat-v1";
  const meetOrigin = "https://meet.google.com";
  const chatOrigin = "https://chat.google.com";
  function embeddedURL(raw) {
    try {
      const url = new URL(raw);
      return url.origin === chatOrigin && /^\/(?:u\/\d+\/)?embed\/space\/[^/]+$/.test(url.pathname) && url.searchParams.get("origin") === meetOrigin;
    } catch { return false; }
  }
  if (location.origin === meetOrigin) {
    globalThis.MeetEmbeddedChat = {
      frame() {
        const frames = [...document.querySelectorAll('iframe')].filter(frame => embeddedURL(frame.src) && frame.getClientRects().length && getComputedStyle(frame).visibility !== "hidden");
        return frames.length === 1 ? frames[0] : null;
      },
      send(frame, message, active) {
        return new Promise((resolve, reject) => {
          const id = crypto.randomUUID();
          let requested = false;
          const started = Date.now();
          const post = type => frame.contentWindow.postMessage({ channel, id, type, ...(type === "send" ? { message } : {}) }, chatOrigin);
          function finish(error) {
            clearInterval(timer);
            window.removeEventListener("message", receive);
            if (error) { post("cancel"); reject(new Error(error)); }
            else resolve();
          }
          function receive(event) {
            if (event.origin !== chatOrigin || event.source !== frame.contentWindow) return;
            const data = event.data;
            if (data?.channel !== channel || data.id !== id) return;
            if (data.type === "ready" && !requested) {
              if (!active()) return finish("Call ended before the chat notice was sent.");
              requested = true; post("send");
            } else if (data.type === "result" && requested) {
              finish(data.warning || "");
            }
          }
          function tick() {
            if (!active()) return finish("Call ended before the chat notice was sent.");
            if (!frame.isConnected || !embeddedURL(frame.src)) return finish("Meeting chat closed before the notice was sent. Please announce the transcript manually.");
            if (Date.now() - started > (requested ? 20000 : 10000)) return finish("Chat notice could not be confirmed. Please let participants know manually.");
            // Only readiness probes repeat. An uncertain send is never retried.
            if (!requested) post("probe");
          }
          window.addEventListener("message", receive);
          const timer = setInterval(tick, 100);
          tick();
        });
      },
    };
  } else if (embeddedURL(location.href) && window.parent !== window) {
    let request = null;
    // One attempt per recording. The top Meet frame creates a new ID for a new call.
    const attempted = new Set();
    window.addEventListener("message", async event => {
      if (event.origin !== meetOrigin || event.source !== window.parent) return;
      const data = event.data;
      if (data?.channel !== channel || typeof data.id !== "string" || data.id.length > 100) return;
      const reply = payload => event.source.postMessage({ channel, id: data.id, ...payload }, meetOrigin);
      if (data.type === "probe") {
        if (MeetAdapter.chatInput()) reply({ type: "ready" });
        return;
      }
      if (data.type === "cancel") {
        if (request?.id === data.id) request.active = false;
        return;
      }
      if (data.type !== "send" || typeof data.message !== "string" || !data.message.trim() || data.message.length > 10000 || attempted.has(data.id)) return;
      attempted.add(data.id);
      if (request) {
        reply({ type: "result", warning: "A chat notice is already in progress. Please announce the transcript manually." });
        return;
      }
      const current = { id: data.id, active: true };
      request = current;
      const notice = new MeetChatNotice(data.message);
      await notice.send(() => current.active, () => {});
      reply({ type: "result", warning: notice.warning });
      request = null;
    });
  }
})();
