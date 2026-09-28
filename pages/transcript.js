import { request, time, date, minutes, plainText, node, iconButton, isOpen, statusDot, notify } from "./shared.js";
const id = new URLSearchParams(location.search).get("id");
const $ = selector => document.querySelector(selector);
let session, editing = false, saving = false, recoveryNotified = false;
const edit = iconButton("Edit call title", "edit"); $("#edit-action").append(edit);
const selectAll = node("input"); selectAll.type = "checkbox"; selectAll.setAttribute("aria-label", "Select all speaker sections");
const copySelected = iconButton("Copy selected transcript", "copy");
const downloadSelected = iconButton("Download selected TXT", "download");
const selectionTools = node("div", undefined, "transcript-tools");
selectionTools.setAttribute("aria-label", "Export selected speaker sections");
const allLabel = node("label", undefined, "select-all-label"); allLabel.append(selectAll, node("span", "Select all"));
const selectionCount = node("span", "0 selected", "selection-count");
copySelected.classList.add("text-action"); copySelected.append(node("span", "Copy selection"));
downloadSelected.classList.add("text-action"); downloadSelected.append(node("span", "Download selection TXT"));
selectionTools.append(allLabel, selectionCount, copySelected, downloadSelected);
let selectedBlocks = new Set();
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const area = node("textarea", text); area.style.position = "fixed"; area.style.opacity = "0";
    document.body.append(area);
    try { area.select(); if (!document.execCommand("copy")) throw new Error("Could not copy. Please try again."); }
    finally { area.remove(); }
  }
}
function speakerHue(name) { return [...name].reduce((h, c) => (h * 31 + c.codePointAt(0)) % 360, 0); }
async function run(work) { try { await work(); } catch (e) { $("#message").textContent = ""; notify(e.message, "error"); } }
function download() {
  const url = URL.createObjectURL(new Blob([plainText(session)], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url;
  a.download = (session.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 150) || "Transcript") + ".txt";
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function render() {
  $("#detail").hidden = false;
  if (!editing) { $("#heading").textContent = session.title; $("#title").value = session.title; }
  document.title = session.title;
  $("#meta").replaceChildren(node("span", `${date(session.startTime)} · ${time(session.startTime)}–${time(session.endTime || session.updatedAt)} · ${minutes(session)} min`));
  const dot = statusDot(session.status); if (dot) $("#meta").append(dot);
  $("#participants").replaceChildren();
  for (const name of session.participants) $("#participants").append(node("span", name, "participant"));
  if (!session.participants.length) $("#participants").textContent = "No speakers captured";
  if (session.status === "interrupted" && !recoveryNotified) {
    notify("Recovered after interruption. The final moments may be missing.", "info");
    recoveryNotified = true;
  }
  const textAction = (label, icon) => { const button = iconButton(label, icon); button.classList.add("text-action"); button.append(node("span", label)); return button; };
  $("#actions").replaceChildren(textAction("Copy Transcript", "copy"), textAction("Download TXT", "download"), textAction("Delete Call", "delete"));
  const [copyAction, downloadAction, deleteAction] = $("#actions").children;
  copyAction.addEventListener("click", () => run(async () => { await copyText(plainText(session)); notify("Transcript copied."); }));
  downloadAction.addEventListener("click", download);
  deleteAction.classList.add("danger"); deleteAction.disabled = isOpen(session); deleteAction.addEventListener("click", () => {
      if (confirm(`Permanently delete “${session.title}” and all its recording segments?`)) run(async () => {
        await request("delete", { id }); location.href = "transcripts.html";
      });
    });
  $("#blocks").replaceChildren();
  if (!selectionTools.parentNode) $("#blocks").before(selectionTools);
  let previous, group, groupIndex = -1;
  for (const block of session.blocks) {
    const sameTurn = previous?.speaker === block.speaker;
    if (!sameTurn) {
      groupIndex++;
      const turnIndex = groupIndex;
      group = node("section", undefined, "speaker-turn"); group.dataset.index = groupIndex; group.style.setProperty("--speaker-hue", speakerHue(block.speaker));
      const check = node("input"); check.type = "checkbox"; check.className = "speaker-check"; check.setAttribute("aria-label", `Select ${block.speaker} section`); check.checked = selectedBlocks.has(groupIndex);
      check.addEventListener("change", () => { check.checked ? selectedBlocks.add(turnIndex) : selectedBlocks.delete(turnIndex); updateSelection(); });
      const header = node("header", undefined, "speaker-heading");
      const initials = block.speaker.split(/\s+/).slice(0, 2).map(w => [...w][0]).join("");
      const avatar = node("span", initials, "avatar"); avatar.setAttribute("aria-hidden", "true");
      const copyTurn = iconButton("Copy speaker section", "copy"); copyTurn.classList.add("turn-copy");
      const turnGroup = group;
      copyTurn.addEventListener("click", () => run(async () => {
        await copyText([...turnGroup.querySelectorAll("p")].map(p => p.textContent).join("\n"));
        notify("Speaker section copied.");
      }));
      header.append(check, avatar, node("h2", block.speaker), node("span", "·", "separator"), node("time", time(block.timestamp)), copyTurn);
      group.append(header); $("#blocks").append(group);
    }
    if (sameTurn && time(previous.timestamp) !== time(block.timestamp)) group.append(node("time", time(block.timestamp), "turn-time"));
    const paragraph = node("p", block.text); paragraph.title = time(block.timestamp);
    group.append(paragraph); previous = block;
  }
  if (!session.blocks.length) $("#blocks").append(node("p", "No captions were captured.", "muted"));
  updateSelection();
}
function updateSelection() {
  const turns = [...document.querySelectorAll(".speaker-turn")];
  for (const index of selectedBlocks) if (index >= turns.length) selectedBlocks.delete(index);
  const count = selectedBlocks.size;
  selectAll.checked = count > 0 && count === turns.length;
  selectAll.disabled = !turns.length;
  selectAll.indeterminate = count > 0 && !selectAll.checked;
  copySelected.disabled = downloadSelected.disabled = !count;
  selectionCount.textContent = `${count} selected`;
  turns.forEach((turn, index) => turn.classList.toggle("selected", selectedBlocks.has(index)));
}
function selectedText() {
  const groups = [...document.querySelectorAll(".speaker-turn")].filter((_, i) => selectedBlocks.has(i));
  return groups.flatMap(group => {
    const heading = group.querySelector("h2")?.textContent || "Speaker";
    return [`${heading} — ${group.querySelector("time")?.textContent || ""}`, ...[...group.querySelectorAll("p")].map(p => p.textContent).filter(Boolean)];
  }).join("\n\n");
}
selectAll.addEventListener("change", () => {
  selectedBlocks = selectAll.checked ? new Set([...document.querySelectorAll(".speaker-turn")].map((_, i) => i)) : new Set();
  render();
});
copySelected.addEventListener("click", () => run(async () => {
  const text = selectedText(), count = selectedBlocks.size;
  if (text) { await copyText(text); notify(`${count} selected speaker section${count === 1 ? "" : "s"} copied.`); }
}));
downloadSelected.addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([selectedText()], { type: "text/plain;charset=utf-8" }));
  const a = node("a"); a.href = url; a.download = `${session.title} selected.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
});
async function refresh() {
  session = await request("get", { id });
  if (!session) { $("#detail").hidden = true; throw new Error("Call not found."); }
  render();
}
function beginEdit() {
  if (editing || saving) return;
  editing = true; $(".title-display").hidden = true; $("#rename").hidden = false;
  $("#title").value = session.title; $("#title").focus(); $("#title").select();
}
function endEdit() {
  editing = false; $(".title-display").hidden = false; $("#rename").hidden = true;
  render();
}
async function saveTitle() {
  if (!editing || saving) return;
  const title = $("#title").value.trim();
  if (!title || title === session.title) { endEdit(); return; }
  saving = true;
  try { session = await request("rename", { id, title }); endEdit(); $("#message").textContent = ""; }
  catch (e) { notify(e.message, "error"); }
  finally { saving = false; }
}
edit.addEventListener("click", beginEdit);
$("#heading").addEventListener("dblclick", beginEdit);
$("#title").addEventListener("keydown", e => {
  if (e.key === "Escape" && !saving) { e.preventDefault(); endEdit(); edit.focus(); }
});
$("#title").addEventListener("blur", saveTitle);
$("#rename").addEventListener("submit", event => { event.preventDefault(); saveTitle(); });
run(async () => { await refresh(); $("#message").textContent = ""; });
setInterval(() => { if (!document.hidden && !editing && !saving && session && isOpen(session)) run(refresh); }, 5000);
