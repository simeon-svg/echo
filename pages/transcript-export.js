export const DEFAULT_AI_PROMPT = `Analyze the meeting transcript below and produce a detailed, well-organized summary in English, regardless of the transcript's original language.
The meeting may involve clients, internal team members, or both, and may cover project discovery, technical discussions, progress updates, planning, or strategic decisions. Adapt the summary to the actual content and context of the conversation.
Write from the perspective of an independent observer. Use neutral, third-person language without suggesting who authored the summary. Clearly identify individuals, companies, or teams and their responsibilities whenever relevant. For example, write "John will prepare the initial designs" rather than "We will prepare the initial designs."
Organize the summary into a small number of meaningful categories based on the topics discussed. Use descriptive headings followed by flat bullet lists, without nested lists. Keep business, technical, and design discussions separate when appropriate. Include dedicated "Next Steps" and "Open Questions" sections when relevant.
Capture all important requirements, technical details, proposals, decisions, agreements, responsibilities, and follow-up actions. Clearly distinguish confirmed decisions from suggestions and unresolved matters. Include responsible individuals and deadlines when established. Do not invent information or assign responsibilities based on assumptions.
Keep every bullet short, clear, precise, and self-contained. Each bullet should communicate one distinct point. Split complex topics into multiple statements when necessary. Preserve important details without lengthy explanations, repetition, or unnecessary fragmentation. Organize information logically rather than chronologically.
The transcript may contain English, Bulgarian, or mixed-language conversations. Interpret the intended meaning using context rather than translating literally. Account for inaccurate speech recognition, particularly in Bulgarian, including incorrect technical terminology, incomplete sentences, and unreliable speaker attribution. Correct obvious transcription errors when the context is clear. Never invent missing information or turn ambiguous statements into confirmed decisions.
Exclude small talk, irrelevant discussions, and conversational filler. Consolidate repeated information and prioritize final decisions when discussions evolve. Include enough detail for someone who did not attend the meeting to understand what was discussed, agreed, assigned, and left unresolved.
Output only the structured meeting summary in English, without introductory commentary, conclusions, or references to the summarization process.`;

// Only interactive exports use this preference; saved calls and backups stay prompt-free.
export async function exportText(text) {
  const { includeAiPrompt, aiPrompt } = await chrome.storage.local.get({ includeAiPrompt: false, aiPrompt: DEFAULT_AI_PROMPT });
  if (!includeAiPrompt || !text) return text;
  const prompt = typeof aiPrompt === "string" && aiPrompt.trim() ? aiPrompt.trim() : DEFAULT_AI_PROMPT;
  return `${prompt}\n\n---\n\nTranscript:\n\n${text}`;
}
