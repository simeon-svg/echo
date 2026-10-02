import { node, shortDate, time, minutes } from "./shared.js";

export function reviewMerge(calls) {
  return new Promise(resolve => {
    const dialog = node("dialog", undefined, "confirm-dialog");
    dialog.setAttribute("aria-labelledby", "merge-review-title");
    const form = node("form"); form.method = "dialog";
    const heading = node("h2", "Review possible same-call recordings"); heading.id = "merge-review-title";
    form.append(heading, node("p", "These recordings may belong to one conversation based on their Meet link, recording times and participants. Choose the recordings to merge. Original backup files will be kept.", "muted"));
    const choices = new Set(calls.map(call => call.id));
    const list = node("div", undefined, "merge-review-list");
    const merge = node("button", "Merge selected", "primary-action"); merge.type = "button";
    const update = () => {
      merge.disabled = choices.size < 2;
      merge.textContent = `Merge selected (${choices.size})`;
    };
    for (const call of [...calls].sort((a, b) => a.startTime - b.startTime)) {
      const option = node("label", undefined, "merge-review-item");
      const checkbox = node("input"); checkbox.type = "checkbox"; checkbox.checked = true;
      checkbox.setAttribute("aria-label", `Include ${call.title}`);
      checkbox.addEventListener("change", () => {
        checkbox.checked ? choices.add(call.id) : choices.delete(call.id); update();
      });
      const detail = node("span");
      detail.append(node("strong", call.title),
        node("span", `${shortDate(call.startTime)} · ${time(call.startTime)}–${time(call.endTime)} · ${minutes(call)} min`, "muted"));
      if (call.participants.length) detail.append(node("span", call.participants.join(", "), "muted"));
      option.append(checkbox, detail); list.append(option);
    }
    const actions = node("div", undefined, "dialog-actions");
    const cancel = node("button", "Cancel"); cancel.type = "button";
    actions.append(cancel, merge); form.append(list, actions); dialog.append(form); document.body.append(dialog);
    const finish = ids => { dialog.close(); dialog.remove(); resolve(ids); };
    cancel.addEventListener("click", () => finish(null));
    merge.addEventListener("click", () => { if (choices.size >= 2) finish([...choices]); });
    dialog.addEventListener("cancel", event => { event.preventDefault(); finish(null); });
    update(); dialog.showModal();
  });
}
