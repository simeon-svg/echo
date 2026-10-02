/* Shared by the content script and dependency-free Node tests. */
(() => {
  "use strict";
  const clean = text => text.replace(/\s+/gu, " ").trim();
  const words = text => clean(text).split(" ").filter(Boolean);
  const key = word => word.toLocaleLowerCase().replace(/[.,!?;:…]+$/u, "");
  function overlap(before, after) {
    const a = words(before), b = words(after);
    for (let n = Math.min(a.length, b.length); n > 0; n--) {
      if (a.slice(-n).every((w, i) => key(w) === key(b[i]))) return n;
    }
    return 0;
  }
  function common(before, after) {
    const a = words(before), b = words(after);
    let n = 0;
    while (n < Math.min(a.length, b.length) && key(a[n]) === key(b[n])) n++;
    return n;
  }

  class CaptionParser {
    constructor() {
      this.blocks = [];
      this.rows = new Map();
      this.blocked = new Set();
      this.next = 0;
    }
    // Existing DOM rows may include speech from before recording. Ignore them completely
    // until Meet replaces/removes them; never guess a boundary inside old text.
    boundary(rows) {
      this.rows.clear();
      this.blocked = new Set(rows.map(row => row.id));

    }
    update(rows, at = Date.now()) {
      const present = new Set(rows.map(row => row.id));
      for (const id of this.rows.keys()) if (!present.has(id)) this.rows.delete(id);
      for (const id of this.blocked) if (!present.has(id)) this.blocked.delete(id);
      let changed = false;
      for (const row of rows) {
        let text = clean(row.text || "");
        const speaker = clean(row.speaker || "");
        if (!text || !speaker || this.blocked.has(row.id)) continue;
        let state = this.rows.get(row.id);
        if (state && state.raw === text && state.speaker === speaker && state.isSelf === row.isSelf) continue;
        const makeBlock = value => {
          const block = { id: ++this.next, speaker, timestamp: at, speechMs: 400, text: value };
          if (typeof row.isSelf === "boolean") block.isSelf = row.isSelf;
          this.blocks.push(block);
          return block;
        };
        if (!state || state.speaker !== speaker || state.isSelf !== row.isSelf) {
          state = { speaker, isSelf: row.isSelf, raw: text, prefix: "", carry: "", block: makeBlock(text), at };
          this.rows.set(row.id, state);
        } else {
          const sameStart = common(state.raw, text);
          const oldWords = words(state.raw);
          const newWords = words(text);
          const shared = overlap(state.raw, text);
          const cumulative = sameStart > 0 || oldWords.length === 1;
          // A meaningful pause in a cumulative row starts a new readable block.
          if (at - state.at >= 4000 && sameStart >= oldWords.length && newWords.length > oldWords.length) {
            state.prefix = text.slice(0, newWords.slice(0, sameStart).join(" ").length);
            state.carry = "";
            state.block = makeBlock(newWords.slice(sameStart).join(" "));
          } else if (cumulative) {
            const skip = state.prefix ? common(state.prefix, text) : 0;
            const value = newWords.slice(skip).join(" ");
            if (value) state.block.text = state.carry + value;
          } else if (shared >= 2) {
            // Meet can roll old words out of a row; retain the earlier words.
            const prior = words(state.block.text);
            state.carry = prior.slice(0, -shared).join(" ") + " ";
            state.block.text = state.carry + text;
            state.prefix = "";
          } else {
            state.block = makeBlock(text);
            state.prefix = "";
            state.carry = "";
          }
          if (state.block.timestamp !== at) state.block.speechMs += Math.min(4000, Math.max(0, at - state.at));
          state.raw = text;
          state.at = at;
        }
        changed = true;
      }
      return changed;
    }
  }
  globalThis.MeetCaptionParser = CaptionParser;
  if (typeof module !== "undefined") module.exports = { CaptionParser };
})();
