import { notify } from "./shared.js";
const fields = { autoStart: document.querySelector("#auto-start"), announceRecording: document.querySelector("#announce-recording") };
async function load() {
  try {
    const settings = await chrome.storage.local.get({ autoStart: true, announceRecording: true });
    for (const [key, field] of Object.entries(fields)) {
      field.checked = settings[key]; field.disabled = false;
      field.addEventListener("change", async () => {
        const value = field.checked;
        field.disabled = true;
        try { await chrome.storage.local.set({ [key]: value }); notify("Setting saved."); }
        catch (error) { field.checked = !value; notify(error.message, "error"); }
        finally { field.disabled = false; }
      });
    }
  } catch (error) { notify(error.message, "error"); }
}
document.querySelector("#settings").addEventListener("submit", event => event.preventDefault());
load();
