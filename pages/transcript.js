import { exportText } from "./transcript-export.js";
import { initPageShell } from "./page-shell.js";
import { transcriptEntries, gapLabel, speakingStats } from "../storage/calls.js";
import { confirmAction, confirmDeletion, request, time, date, minutes, plainText, node, iconButton, isOpen, statusDot, notify } from "./shared.js";
import { prepareBackupAccess, requestBackupAccess } from "./backup-access.js";
const id = new URLSearchParams(location.search).get("id");
const $ = selector => document.querySelector(selector);
initPageShell();
let noteEditing = false;
let displayNameRefreshPending = false;
let session, editing = false, saving = false;
const edit = iconButton("Edit call title", "edit"); edit.disabled = true; $("#edit-action").append(edit);
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
  text = await exportText(text);
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
async function download() {
  const url = URL.createObjectURL(new Blob([await exportText(plainText(session))], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url;
  a.download = (session.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 150) || "Transcript") + ".txt";
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  notify(`TXT download started: ${session.title}`);
}
function exportParagraph(p) {
  if (p.dataset.noteKind) return `[${p.dataset.noteKind} — ${p.dataset.noteTime}]${p.dataset.noteKind === "AUTHOR NOTE" ? `\n${p.textContent.split("\n").map(line => `> ${line}`).join("\n")}` : ""}`;
  return p.textContent;
}
function renderBookmark(note, parent) {
  const card = node("aside", undefined, "author-note"); card.dataset.bookmarkId = note.id;
  const heading = node("div", undefined, "note-heading");
  const label = node("strong", undefined, "note-label");
  label.append(iconButton("Bookmark", "bookmark").children[0], node("span", `Bookmark · ${time(note.timestamp)}`));
  const removeBookmark = iconButton("Remove bookmark and its note", "delete");
  removeBookmark.classList.add("bookmark-delete"); heading.append(label, removeBookmark); card.append(heading);
  // Bookmark and author text remain explicit and separate in selected-section exports.
  const marker = node("p", ""); marker.hidden = true;
  marker.dataset.noteKind = "BOOKMARK"; marker.dataset.noteTime = time(note.timestamp); card.append(marker);
  const hasNote = !!note.text.trim();
  const body = node("div", undefined, "personal-note");
  const editNote = hasNote ? iconButton("Edit personal note", "edit") : node("button", "Add Note", "note-add");
  editNote.type = "button";
  if (hasNote) {
    editNote.classList.add("note-edit");
    const noteHeading = node("div", undefined, "note-heading personal-note-heading");
    noteHeading.append(node("strong", "Author note", "note-label"), editNote);
    const text = node("p", note.text, "note-text");
    text.dataset.noteKind = "AUTHOR NOTE"; text.dataset.noteTime = time(note.timestamp);
    body.append(noteHeading, text);
  } else body.append(editNote);
  card.append(body); parent.append(card);
  const editNoteText = () => {
    if (noteEditing) return;
    noteEditing = true; body.hidden = true;
    const area = node("textarea"); area.value = note.text; area.maxLength = 10000; area.setAttribute("aria-label", "Personal author note");
    const save = node("button", "Save note", "note-save"), cancel = node("button", "Cancel", "note-cancel");
    save.type = cancel.type = "button";
    const form = node("div", undefined, "note-form"); form.append(area, save, cancel); card.append(form);
    cancel.addEventListener("click", () => { noteEditing = false; render(); });
    save.addEventListener("click", () => run(async () => {
      save.disabled = cancel.disabled = true;
      try {
        await request("bookmarkUpdate", { id, segmentId: note.segmentId, bookmarkId: note.id, text: area.value });
        noteEditing = false; await refresh();
      } finally { save.disabled = cancel.disabled = false; }
    }));
    area.focus();
  };
  editNote.addEventListener("click", editNoteText);
  removeBookmark.addEventListener("click", () => run(async () => {
    if (noteEditing || !await confirmDeletionNote()) return;
    removeBookmark.disabled = true;
    try { await request("bookmarkDelete", { id, segmentId: note.segmentId, bookmarkId: note.id }); await refresh(); }
    finally { removeBookmark.disabled = false; }
  }));
  return editNoteText;
}
async function bookmarkReply(block) {
  if (noteEditing) return;
  await request("bookmarkAdd", { id, segmentId: block.segmentId, blockId: block.id });
  await refresh();
  notify("Bookmark saved.");
}
function confirmDeletionNote() {
  return confirmAction({ title: "Remove this bookmark?", message: "Its personal note will also be removed.", confirmLabel: "Remove", danger: true });
}
function render() {
  $("#detail").hidden = false;
  if (!editing) { $("#heading").textContent = session.title; $("#heading").title = session.title; $("#title").value = session.title; }
  edit.disabled = false;
  document.title = session.title;
  $("#meta").replaceChildren(node("span", `${date(session.startTime)} · ${time(session.startTime)}–${time(session.endTime || session.updatedAt)} · ${minutes(session)} min`));
  if (session.bookmarks?.length) {
    const notes = session.bookmarks.filter(n => n.text.trim()).length;
    $("#meta").append(node("span", `${session.bookmarks.length} bookmark${session.bookmarks.length === 1 ? "" : "s"} · ${notes} note${notes === 1 ? "" : "s"}`, "bookmark-count"));
  }
  const dot = statusDot(session.status); if (dot) $("#meta").append(dot);
  const stats = speakingStats(session);
  $("#blocks").replaceChildren();
  if (!selectionTools.parentNode) $("#blocks").before(selectionTools);
  let previous, group, groupIndex = -1;
  const targets = new Map();
  const entries = transcriptEntries(session);
  for (const { block, note, gap } of entries) {
    if (gap) {
      const marker = node("aside", `[RECORDING GAP — ${gapLabel(gap, time)}]`, "recording-gap");
      marker.tabIndex = -1; $("#blocks").append(marker); targets.set(gap, marker);
      previous = null; group = null; continue;
    }
    if (note) {
      // Anchored notes are included when exporting their speaker section.
      renderBookmark(note, group || $("#blocks"));
      const parent = group || $("#blocks");
      targets.set(note, parent.children[parent.children.length - 1]); continue;
    }
    const sameTurn = previous?.speaker === block.speaker && previous?.segmentId === block.segmentId;
    if (!sameTurn) {
      groupIndex++;
      const turnIndex = groupIndex;
      group = node("section", undefined, "speaker-turn"); group.dataset.index = groupIndex; group.dataset.timestamp = block.timestamp; group.style.setProperty("--speaker-hue", speakerHue(block.speaker));
      const check = node("input"); check.type = "checkbox"; check.className = "speaker-check"; check.setAttribute("aria-label", `Select ${block.speaker} section`); check.checked = selectedBlocks.has(groupIndex);
      check.addEventListener("change", () => { check.checked ? selectedBlocks.add(turnIndex) : selectedBlocks.delete(turnIndex); updateSelection(); });
      const header = node("header", undefined, "speaker-heading");
      const initials = block.speaker.split(/\s+/).slice(0, 2).map(w => [...w][0]).join("");
      const avatar = node("span", initials, "avatar"); avatar.setAttribute("aria-hidden", "true");
      const copyTurn = iconButton("Copy speaker section", "copy"); copyTurn.classList.add("turn-copy");
      const turnBookmark = iconButton("Bookmark speaker section", "bookmark"); turnBookmark.classList.add("turn-bookmark");
      turnBookmark.addEventListener("click", () => run(async () => {
        if (noteEditing) return;
        turnBookmark.disabled = true;
        try { await bookmarkReply(block); } finally { turnBookmark.disabled = false; }
      }));
      const turnActions = node("div", undefined, "turn-actions"); turnActions.append(copyTurn, turnBookmark);
      const turnGroup = group;
      copyTurn.addEventListener("click", () => run(async () => {
        await copyText([...turnGroup.querySelectorAll("p")].map(exportParagraph).join("\n"));
        notify("Speaker section copied.");
      }));
      header.append(check, avatar, node("h2", block.speaker), node("span", "·", "separator"), node("time", time(block.timestamp)), turnActions);
      group.append(header); $("#blocks").append(group);
    }
    if (sameTurn && time(previous.timestamp) !== time(block.timestamp)) group.append(node("time", time(block.timestamp), "turn-time"));
    const paragraph = node("p", block.text); paragraph.title = time(block.timestamp);
    paragraph.className = "transcript-reply";
    const reply = node("div", undefined, "reply"); reply.append(paragraph); group.append(reply); targets.set(block, reply); previous = block;
  }
  if (!session.blocks.length) $("#blocks").append(node("p", "No captions were captured.", "muted empty-state"));
  renderTimeline(stats, targets);
  updateSelection();
}
let mapSticky = false, mapExpanded = false, mapPinned = false, mapAllSpeakers = false;
let mapLastScroll = 0, mapDetails, mapToggle, mapMore, mapSpacer;
function updateMapView() {
  const map = $("#timeline");
  map.dataset.compact = String(mapSticky && !mapExpanded);
  map.dataset.sticky = String(mapSticky);
  if (mapDetails) mapDetails.hidden = mapSticky && !mapExpanded;
  if (mapToggle) {
    mapToggle.hidden = !mapSticky;
    mapToggle.setAttribute("aria-label", mapExpanded ? "Collapse conversation map" : "Expand conversation map");
    mapToggle.setAttribute("aria-expanded", String(mapExpanded));
    mapToggle.title = mapExpanded ? "Collapse conversation map" : "Expand conversation map";
  }
  if (mapDetails) for (const row of mapDetails.querySelectorAll(".map-extra")) row.hidden = !mapAllSpeakers;
  if (mapMore) {
    const label = mapAllSpeakers ? "Fewer speakers" : `${mapMore.dataset.count} more speakers`;
    mapMore.children[1].textContent = label;
    mapMore.setAttribute("aria-label", label); mapMore.title = label;
    mapMore.setAttribute("aria-expanded", String(mapAllSpeakers));
  }
}
function initMapInteraction() {
  const map = $("#timeline"), sentinel = $("#timeline-start");
  mapSpacer = $("#timeline-spacer");
  map.addEventListener("pointerenter", event => { if (event.pointerType !== "touch" && mapSticky) { mapExpanded = true; updateMapView(); } });
  map.addEventListener("pointerleave", () => { if (mapSticky && !mapPinned) { mapExpanded = false; updateMapView(); } });
  map.addEventListener("focusin", event => { if (mapSticky && event.target !== mapToggle) { mapExpanded = true; updateMapView(); } });
  window.addEventListener("scroll", () => {
    const scroll = window.scrollY;
    const sticky = sentinel.getBoundingClientRect().top <= 8;
    if (sticky !== mapSticky) {
      if (sticky) mapSpacer.style.height = `${mapDetails?.getBoundingClientRect().height || 0}px`;
      else mapSpacer.style.height = "0px";
      mapSticky = sticky; mapExpanded = false; mapPinned = false;
    }
    if (mapSticky && scroll > mapLastScroll) {
      // Scrolling resumes the compact view even while the pointer remains over it.
      if (mapDetails?.contains(document.activeElement)) mapToggle.focus({ preventScroll: true });
      mapExpanded = false; mapPinned = false; mapAllSpeakers = false;
    }
    mapLastScroll = scroll; updateMapView();
  }, { passive: true });
}
function transcriptActions() {
  const actions = node("div", undefined, "map-actions");
  actions.setAttribute("aria-label", "Transcript actions");
  const copyAction = iconButton("Copy Transcript", "copy"), downloadAction = iconButton("Download TXT", "download"), deleteAction = iconButton("Delete Call", "delete");
  actions.append(copyAction, downloadAction, deleteAction);
  copyAction.addEventListener("click", () => run(async () => { await copyText(plainText(session)); notify("Transcript copied."); }));
  downloadAction.addEventListener("click", () => run(download));
  deleteAction.classList.add("danger"); deleteAction.disabled = isOpen(session); deleteAction.addEventListener("click", () => run(async () => {
      if (session.hasBackup) await prepareBackupAccess();
      const decision = await confirmDeletion({ label: session.title, backupAvailable: !!session.hasBackup, beforeDeleteBackup: requestBackupAccess });
      if (decision.confirmed) {
        const result = await request("delete", { id, deleteBackup: decision.deleteBackup });
        if (result.backupWarning) notify(`The conversation was deleted, but its backup remains: ${result.backupWarning}`, "error");
        else notify(`Conversation deleted: ${session.title}`);
        location.href = "transcripts.html";
      }
    }));
  return actions;
}
function renderTimeline(stats, targets) {
  const map = $("#timeline"); map.replaceChildren();
  const start = session.blocks.length ? Math.min(...session.blocks.map(block => block.timestamp)) : session.startTime;
  const speechEnd = stats.spans.reduce((end, { block, duration }) => Math.max(end, block.timestamp + duration), start);
  const end = Math.max(start + 1, session.blocks.length ? speechEnd : session.endTime || session.updatedAt || start);
  const length = end - start;
  const position = at => Math.max(0, Math.min(100, (at - start) / length * 100));
  const header = node("div", undefined, "map-header");
  mapToggle = iconButton("Expand conversation map", "chevron"); mapToggle.classList.add("map-toggle");
  mapToggle.setAttribute("aria-controls", "map-details");
  mapToggle.addEventListener("click", () => { mapExpanded = !mapExpanded; mapPinned = mapExpanded; updateMapView(); });
  const combined = node("div", undefined, "map-track map-combined");
  combined.setAttribute("aria-label", "All speakers, gaps and notes");
  header.append(mapToggle, node("strong", "Conversation map"), combined, transcriptActions()); map.append(header);
  mapDetails = node("div", undefined, "map-details"); mapDetails.id = "map-details"; map.append(mapDetails);
  const jump = (item, label, className) => {
    const button = node("button", undefined, className); button.type = "button"; button.title = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", () => {
      const target = targets.get(item); if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "center" }); target.tabIndex = -1; target.focus({ preventScroll: true });
      const highlight = target.closest(".speaker-turn") || target;
      highlight.classList.add("timeline-arrival");
      setTimeout(() => highlight.classList.remove("timeline-arrival"), 2200);
    });
    return button;
  };
  const markSpeech = ({ block, duration }, track) => {
    const mark = jump(block, `${block.speaker} · ${time(block.timestamp)} · ${block.text.slice(0, 100)}`, "map-speech");
    mark.style.setProperty("--speaker-hue", speakerHue(block.speaker));
    mark.style.left = `${position(block.timestamp)}%`; mark.style.width = `${Math.min(100 - position(block.timestamp), duration / length * 100)}%`;
    track.append(mark);
  };
  const mapSpans = [];
  for (const span of stats.spans) {
    if (span.duration <= 0) continue;
    const previous = mapSpans.at(-1);
    const sameTurn = previous && previous.block.speaker === span.block.speaker &&
      previous.block.segmentId === span.block.segmentId &&
      !(session.gaps || []).some(gap => gap.timestamp >= previous.block.timestamp && gap.timestamp <= span.block.timestamp);
    if (sameTurn) previous.duration = Math.max(previous.duration, span.block.timestamp + span.duration - previous.block.timestamp);
    else mapSpans.push({ block: span.block, duration: span.duration });
  }
  for (const span of mapSpans) markSpeech(span, combined);
  const ranked = [...stats.participants].sort((a, b) => b.duration - a.duration || a.name.localeCompare(b.name));
  ranked.forEach(({ name, percent }, index) => {
    const row = node("div", undefined, `map-row${index >= 4 ? " map-extra" : ""}`);
    row.style.setProperty("--speaker-hue", speakerHue(name));
    const track = node("div", undefined, "map-track");
    const label = node("span", undefined, "map-label map-participant"); label.title = name;
    label.append(node("span", name, "map-speaker-name"), node("span", `${Math.round(percent)}%`, "map-stat"));
    row.append(label, track);
    for (const span of mapSpans.filter(span => span.block.speaker === name)) markSpeech(span, track);
    mapDetails.append(row);
  });
  if (!ranked.length) mapDetails.append(node("p", "No speakers captured", "muted"));
  mapMore = null;
  if (ranked.length > 4) {
    mapMore = iconButton("More speakers", "chevron"); mapMore.classList.add("map-more");
    mapMore.append(node("span")); mapMore.dataset.count = ranked.length - 4;
    mapMore.setAttribute("aria-controls", "map-details");
    mapMore.addEventListener("click", () => { mapAllSpeakers = !mapAllSpeakers; mapPinned = true; updateMapView(); });
    mapDetails.append(mapMore);
  }
  if (session.gaps?.length) {
    const row = node("div", undefined, "map-row"), track = node("div", undefined, "map-track");
    row.append(node("span", "Gaps", "map-label map-gap-label"), track);
    for (const gap of session.gaps) for (const destination of [track, combined]) {
      if (gap.timestamp >= end) continue;
      const mark = jump(gap, gapLabel(gap, time), "map-gap"); mark.style.left = `${position(gap.timestamp)}%`;
      mark.style.width = `${Math.min(100 - position(gap.timestamp), Math.max(.6, position(gap.endTime ?? gap.timestamp) - position(gap.timestamp)))}%`; destination.append(mark);
    }
    mapDetails.append(row);
  }
  if (session.bookmarks?.length) {
    const row = node("div", undefined, "map-row map-notes"), track = node("div", undefined, "map-track");
    row.append(node("span", `Notes · ${session.bookmarks.length}`, "map-label map-notes-label"), track);
    for (const note of session.bookmarks) for (const destination of [track, combined]) {
      const label = `${time(note.timestamp)} · ${note.text.trim() || "Bookmark"}`;
      const button = jump(note, label, "map-note");
      button.append(iconButton(label, "bookmark").children[0]);
      button.style.setProperty("--note-position", `${position(note.timestamp)}%`);
      destination.append(button);
    }
    mapDetails.append(row);
  }
  updateMapView();
}
initMapInteraction();
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
  return groups.flatMap((group, index) => {
    const gaps = index ? (session.gaps || []).filter(gap => gap.timestamp >= Number(groups[index - 1].dataset.timestamp) && gap.timestamp <= Number(group.dataset.timestamp)).map(gap => `[RECORDING GAP — ${gapLabel(gap, time)}]`) : [];
    const heading = group.querySelector("h2")?.textContent || "Speaker";
    return [...gaps, `${heading} — ${group.querySelector("time")?.textContent || ""}`, ...[...group.querySelectorAll("p")].map(exportParagraph).filter(Boolean)];
  }).join("\n\n");
}
selectAll.addEventListener("change", () => {
  selectedBlocks = selectAll.checked ? new Set([...document.querySelectorAll(".speaker-turn")].map((_, i) => i)) : new Set();
  document.querySelectorAll(".speaker-check").forEach((check, index) => { check.checked = selectedBlocks.has(index); });
  updateSelection();
});
copySelected.addEventListener("click", () => run(async () => {
  const text = selectedText(), count = selectedBlocks.size;
  if (text) { await copyText(text); notify(`${count} selected speaker section${count === 1 ? "" : "s"} copied.`); }
}));
downloadSelected.addEventListener("click", () => run(async () => {
  const url = URL.createObjectURL(new Blob([await exportText(selectedText())], { type: "text/plain;charset=utf-8" }));
  const a = node("a"); a.href = url; a.download = `${session.title} selected.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  notify("Selected TXT download started.");
}));
async function refresh() {
  displayNameRefreshPending = false;
  session = await request("get", { id });
  if (!session) { $("#detail").hidden = true; throw new Error("Call not found."); }
  render();
}
function beginEdit() {
  if (!session || editing || saving) return;
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
// Refresh all surfaces from the same resolved call when the personal name changes.
// Defer while editing so a settings change cannot discard an unfinished draft.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.displayName) return;
  displayNameRefreshPending = true;
  if (!editing && !saving && !noteEditing) run(refresh);
});
setInterval(() => {
  if (!document.hidden && !editing && !saving && !noteEditing &&
    (displayNameRefreshPending || (session && isOpen(session)))) run(refresh);
}, 5000);

window.addEventListener("focus", () => { if (!editing && !saving && !noteEditing) run(refresh); });
