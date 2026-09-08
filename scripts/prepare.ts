import { mkdir, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { voicePrompt, audition, chapters } from "../session";

const root = new URL("../", import.meta.url).pathname;
const data = `${root}data`;
await mkdir(`${data}/audio`, { recursive: true });
const key = process.env.GRADIUM_API_KEY;
if (!key) throw new Error("Add GRADIUM_API_KEY to .env first.");
const base = "https://api.gradium.ai/api";
async function api(path: string, body?: object) {
  const res = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { "x-api-key": key!, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) throw new Error(`Gradium ${path}: HTTP ${res.status}: ${(await res.text()).replaceAll(key!, "[redacted]").slice(0, 500)}`);
  return res;
}
async function tts(voice: string, text: string, name: string) {
  const res = await api("/post/speech/tts", {
    text, voice_id: voice, model_name: "default", output_format: "pcm", only_audio: false,
    json_config: JSON.stringify({ temp: 0.55, padding_bonus: -0.3 }),
  });
  const chunks: Buffer[] = [], words: object[] = [];
  for (const line of (await res.text()).split("\n")) {
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (m.type === "error") throw new Error(`TTS stream error: ${JSON.stringify(m).replaceAll(key!, "[redacted]")}`);
    if (m.type === "ready" && m.sample_rate !== 48000) throw new Error(`Unexpected sample rate ${m.sample_rate}`);
    if (m.type === "audio") chunks.push(Buffer.from(m.audio, "base64"));
    if (m.type === "text") words.push({ text: m.text, start_s: m.start_s, stop_s: m.stop_s });
  }
  const pcm = Buffer.concat(chunks);
  if (pcm.length < 9600 || pcm.length % 2) throw new Error("Missing or malformed PCM audio");
  const wav = Buffer.alloc(44);
  wav.write("RIFF", 0); wav.writeUInt32LE(pcm.length + 36, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(pcm.length, 40);
  await Bun.write(`${data}/audio/${name}.wav`, Buffer.concat([wav, pcm]));
  const info = { audio: `/audio/${name}.wav`, duration: pcm.length / 96000, words };
  await Bun.write(`${data}/audio/${name}.json`, JSON.stringify(info, null, 2));
  console.log(`${name}: ${info.duration.toFixed(1)} seconds, ${words.length} timestamped words`);
  return info;
}
const mode = process.argv[2];
const startedAt = Date.now();
let completedCount = 0;
async function progress(status: string, completed = 0, error?: string) {
  completedCount = completed;
  await Bun.write(`${data}/progress.json.tmp`, JSON.stringify({status, completed, total:chapters.length, startedAt, updatedAt:Date.now(), error}));
  await rename(`${data}/progress.json.tmp`, `${data}/progress.json`);
}
try {
if (mode === "voices") {
  let candidates;
  if (await Bun.file(`${data}/candidates.json`).exists()) {
    candidates = await Bun.file(`${data}/candidates.json`).json();
    console.log("Using saved candidates");
  } else {
    candidates = await (await api("/voice-generator/generate", { prompt: voicePrompt, language: "en", n_samples: 3 })).json();
    await Bun.write(`${data}/candidates.json`, JSON.stringify(candidates, null, 2));
  }
  for (const [i, c] of candidates.embeddings.entries()) {
    const deadline = Date.now() + 120000;
    let ready = false;
    while (Date.now() < deadline) {
      const d = await (await api(`/voice-generator/embeddings?embedding_id=${encodeURIComponent(c.embedding_id)}`)).json();
      if (d.embeddings?.[0]?.ready) { ready = true; break; }
      await Bun.sleep(2000);
    }
    if (!ready) throw new Error(`Candidate ${i + 1} not ready within 120 seconds`);
    if (!(await Bun.file(`${data}/audio/audition-${i + 1}.wav`).exists())) await tts(c.embedding_id, audition, `audition-${i + 1}`);
  }
} else if (mode === "tune") {
  const candidates = await Bun.file(`${data}/candidates.json`).json();
  await tts(candidates.embeddings[1].embedding_id, audition, "audition-2-faster");
} else if (mode === "render") {
  await progress("running");
  const choice = Number(process.argv[3] || 2);
  if (![1, 2, 3].includes(choice)) throw new Error("Choose candidate 1, 2 or 3");
  let kept;
  const voiceFile = `${data}/voice-${choice}.json`;
  if (await Bun.file(voiceFile).exists()) kept = await Bun.file(voiceFile).json();
  else {
    const candidates = await Bun.file(`${data}/candidates.json`).json();
    const candidate = candidates.embeddings[choice - 1].embedding_id;
    kept = await (await api("/voices/from-embedding", {
      voxium_embedding_id: candidate, name: `Quiet painting teacher ${choice}`, description: voicePrompt,
    })).json();
    await Bun.write(voiceFile, JSON.stringify({ ...kept, embedding_id: candidate }, null, 2));
  }
  const rendered = [];
  for (const chapter of chapters) {
    const fingerprint = createHash("sha256").update(JSON.stringify({text:chapter.text,voice:kept.uid,model:"default",temp:.55,padding_bonus:-.3})).digest("hex").slice(0,12);
    const name = `voice${choice}-${chapter.id}-${fingerprint}`;
    const cached = Bun.file(`${data}/audio/${name}.json`);
    const info = await cached.exists() && await Bun.file(`${data}/audio/${name}.wav`).exists() ? await cached.json() : await tts(kept.uid, chapter.text, name);
    rendered.push({ ...chapter, ...info });
    await progress("running", rendered.length);
  }
  await Bun.write(`${data}/manifest.json.tmp`, JSON.stringify({ subject:"Ashwin at the Golden Gate Bridge", voice: { id: kept.uid, prompt: voicePrompt, choice }, chapters: rendered }, null, 2));
  await rename(`${data}/manifest.json.tmp`, `${data}/manifest.json`);
  await progress("complete", rendered.length);
  console.log(`Ready: ${rendered.length} chapters, ${rendered.reduce((s, x) => s + x.duration, 0).toFixed(1)} seconds of narration`);
} else throw new Error("Use voices or render [1|2|3]");
} catch (error) {
  const message = String(error).replaceAll(key!, "[redacted]");
  if (mode === "render") await progress("failed", completedCount, message.slice(0,500));
  console.error(message); process.exitCode=1;
}
