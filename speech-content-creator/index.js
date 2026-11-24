import "dotenv/config";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

const appDirectory = path.dirname(fileURLToPath(import.meta.url));
const outputDirectory = path.join(appDirectory, "output");
const supportedAudioExtensions = new Set([
  ".mp3",
  ".mp4",
  ".mpeg",
  ".mpga",
  ".m4a",
  ".wav",
  ".webm",
]);
const maximumAudioSize = 25 * 1024 * 1024;
let openai;

function requireApiKeys() {
  const missing = [
    ["OPENAI_API_KEY", process.env.OPENAI_API_KEY],
    ["ELEVENLABS_API_KEY", process.env.ELEVENLABS_API_KEY],
    ["ELEVENLABS_VOICE_ID", process.env.ELEVENLABS_VOICE_ID],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`Missing required setting(s): ${missing.join(", ")}.`);
  }
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function parseArguments(args) {
  let audioPath;
  let language;

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--language") {
      const value = args[index + 1];
      if (!value || !/^[a-z]{2}$/i.test(value)) {
        throw new Error("--language requires a two-letter language code, such as en or es.");
      }
      language = value.toLowerCase();
      index += 1;
    } else if (args[index].startsWith("--")) {
      throw new Error(`Unknown option: ${args[index]}.`);
    } else if (audioPath) {
      throw new Error("Provide one audio file path. Use --language to set a language.");
    } else {
      audioPath = args[index];
    }
  }

  return { audioPath, language };
}

function slugify(value) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "speech-content"
  );
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function getAudioPath(inputPath) {
  const resolvedPath = path.resolve(inputPath);
  let fileInfo;
  try {
    fileInfo = await stat(resolvedPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Audio file not found: ${resolvedPath}`);
    }
    throw error;
  }

  if (!fileInfo.isFile()) {
    throw new Error(`Audio input is not a file: ${resolvedPath}`);
  }
  if (!supportedAudioExtensions.has(path.extname(resolvedPath).toLowerCase())) {
    throw new Error(
      `Unsupported audio file type. Use one of: ${[...supportedAudioExtensions].join(", ")}.`,
    );
  }
  if (fileInfo.size === 0 || fileInfo.size > maximumAudioSize) {
    throw new Error("Audio file must be larger than 0 bytes and no larger than 25 MB.");
  }
  return resolvedPath;
}

async function transcribeAudio(filePath, language) {
  const request = {
    file: createReadStream(filePath),
    model: "whisper-1",
    response_format: "verbose_json",
  };
  if (language) request.language = language;

  const transcription = await openai.audio.transcriptions.create(request);
  if (!transcription.text?.trim()) {
    throw new Error("OpenAI returned an empty transcript.");
  }
  return transcription;
}

async function createTextContent(transcript, language) {
  const languageInstruction = language
    ? `Write both outputs in the language identified as "${language}".`
    : "Keep both outputs in the language of the source transcript.";
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a careful editor. Preserve the speaker's meaning and do not invent facts. " +
          `${languageInstruction} Return a concise summary and an enhanced transcript as JSON ` +
          'with string fields "summary" and "enhanced_text". The enhanced transcript should ' +
          "correct grammar and improve clarity while retaining all important details.",
      },
      { role: "user", content: transcript },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned no summary or enhanced text.");
  }

  let result;
  try {
    result = JSON.parse(content);
  } catch {
    throw new Error("OpenAI returned invalid JSON for the summary and enhanced text.");
  }
  if (
    typeof result.summary !== "string" ||
    !result.summary.trim() ||
    typeof result.enhanced_text !== "string" ||
    !result.enhanced_text.trim()
  ) {
    throw new Error("OpenAI returned an empty summary or enhanced text.");
  }
  return {
    summary: result.summary.trim(),
    enhancedText: result.enhanced_text.trim(),
  };
}

async function generateOpenAISpeech(text) {
  const response = await openai.audio.speech.create({
    model: "tts-1",
    voice: "alloy",
    input: text,
    response_format: "mp3",
  });
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length === 0) {
    throw new Error("OpenAI returned an empty audio file.");
  }
  return audio;
}

async function generateElevenLabsSpeech(text) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(process.env.ELEVENLABS_VOICE_ID)}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        Accept: "audio/mpeg",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `ElevenLabs speech generation failed (${response.status}): ${await response.text()}`,
    );
  }
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length === 0) {
    throw new Error("ElevenLabs returned an empty audio file.");
  }
  return audio;
}

function tokenize(text) {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
  return [...segmenter.segment(text.normalize("NFKC").toLocaleLowerCase())]
    .filter((segment) => segment.isWordLike)
    .map((segment) => segment.segment);
}

function compareText(referenceText, generatedText) {
  const reference = tokenize(referenceText);
  const generated = tokenize(generatedText);
  if (reference.length === 0) {
    throw new Error("Cannot compare speech against empty enhanced text.");
  }

  let previousRow = Array.from({ length: generated.length + 1 }, (_, index) => index);
  for (let rowIndex = 1; rowIndex <= reference.length; rowIndex += 1) {
    const currentRow = [rowIndex];
    for (let columnIndex = 1; columnIndex <= generated.length; columnIndex += 1) {
      const substitutionCost =
        reference[rowIndex - 1] === generated[columnIndex - 1] ? 0 : 1;
      currentRow[columnIndex] = Math.min(
        previousRow[columnIndex] + 1,
        currentRow[columnIndex - 1] + 1,
        previousRow[columnIndex - 1] + substitutionCost,
      );
    }
    previousRow = currentRow;
  }

  const errors = previousRow[generated.length];
  const errorRate = errors / reference.length;
  return {
    referenceUnits: reference.length,
    generatedUnits: generated.length,
    errors,
    errorRate: Number(errorRate.toFixed(4)),
    fidelityScore: Number(Math.max(0, 100 * (1 - errorRate)).toFixed(1)),
  };
}

async function compareSpeech(filePath, expectedText, language) {
  const request = {
    file: createReadStream(filePath),
    model: "whisper-1",
    response_format: "verbose_json",
  };
  if (language) request.language = language;
  const result = await openai.audio.transcriptions.create(request);
  return {
    transcript: result.text ?? "",
    ...compareText(expectedText, result.text ?? ""),
  };
}

function buildReport({
  audioFilename,
  language,
  transcript,
  summary,
  enhancedText,
  comparisons,
}) {
  const best = comparisons.reduce((currentBest, current) =>
    current.fidelityScore > currentBest.fidelityScore ? current : currentBest,
  );
  const comparisonRows = comparisons
    .map(
      (comparison) => `
        <tr>
          <td>${escapeHtml(comparison.provider)}</td>
          <td>${comparison.fidelityScore}/100</td>
          <td>${(comparison.errorRate * 100).toFixed(1)}%</td>
          <td><audio controls src="${escapeHtml(comparison.audioFilename)}"></audio></td>
        </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Voice-Powered Content Creator</title>
  <style>
    body { max-width: 900px; margin: 2rem auto; padding: 0 1rem; font: 16px/1.6 system-ui, sans-serif; color: #18181b; }
    section, table { margin: 1.5rem 0; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: .7rem; border: 1px solid #d4d4d8; text-align: left; }
    th { background: #f4f4f5; }
    audio { max-width: 220px; width: 100%; }
    .text { white-space: pre-wrap; }
  </style>
</head>
<body>
  <h1>Voice-Powered Content Creator</h1>
  <p><strong>Source audio:</strong> ${escapeHtml(audioFilename)}</p>
  <p><strong>Detected language:</strong> ${escapeHtml(language || "Not reported")}</p>
  <section>
    <h2>Speech fidelity comparison</h2>
    <p>Score is based on how closely each generated audio transcript matches the enhanced text. It does not rate voice style or sound quality.</p>
    <p><strong>Closest transcript:</strong> ${escapeHtml(best.provider)} (${best.fidelityScore}/100)</p>
    <table>
      <thead><tr><th>Provider</th><th>Fidelity score</th><th>Word/segment error rate</th><th>Audio</th></tr></thead>
      <tbody>${comparisonRows}
      </tbody>
    </table>
  </section>
  <section><h2>Transcript</h2><p class="text">${escapeHtml(transcript)}</p></section>
  <section><h2>Summary</h2><p class="text">${escapeHtml(summary)}</p></section>
  <section><h2>Enhanced text</h2><p class="text">${escapeHtml(enhancedText)}</p></section>
</body>
</html>`;
}

async function createContent(audioPath, language) {
  requireApiKeys();
  const resolvedAudioPath = await getAudioPath(audioPath);
  const audioFilename = path.basename(resolvedAudioPath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDirectory = path.join(
    outputDirectory,
    `${slugify(path.parse(audioFilename).name)}-${timestamp}`,
  );
  await mkdir(runDirectory, { recursive: true });

  console.log("Transcribing audio with OpenAI...");
  const transcription = await transcribeAudio(resolvedAudioPath, language);
  const detectedLanguage = transcription.language ?? language ?? "";

  console.log("Creating a summary and enhanced transcript...");
  const { summary, enhancedText } = await createTextContent(
    transcription.text,
    detectedLanguage,
  );
  await Promise.all([
    writeFile(path.join(runDirectory, "transcript.txt"), transcription.text, "utf8"),
    writeFile(path.join(runDirectory, "summary.txt"), summary, "utf8"),
    writeFile(path.join(runDirectory, "enhanced.txt"), enhancedText, "utf8"),
  ]);

  console.log("Generating speech with OpenAI and ElevenLabs...");
  const [openaiAudio, elevenLabsAudio] = await Promise.all([
    generateOpenAISpeech(enhancedText),
    generateElevenLabsSpeech(enhancedText),
  ]);
  const openaiAudioFilename = "openai-speech.mp3";
  const elevenLabsAudioFilename = "elevenlabs-speech.mp3";
  const openaiAudioPath = path.join(runDirectory, openaiAudioFilename);
  const elevenLabsAudioPath = path.join(runDirectory, elevenLabsAudioFilename);
  await Promise.all([
    writeFile(openaiAudioPath, openaiAudio),
    writeFile(elevenLabsAudioPath, elevenLabsAudio),
  ]);

  console.log("Comparing generated speech transcripts...");
  const comparisons = await Promise.all([
    compareSpeech(openaiAudioPath, enhancedText, language),
    compareSpeech(elevenLabsAudioPath, enhancedText, language),
  ]);
  comparisons[0].provider = "OpenAI";
  comparisons[0].audioFilename = openaiAudioFilename;
  comparisons[1].provider = "ElevenLabs";
  comparisons[1].audioFilename = elevenLabsAudioFilename;

  const report = {
    sourceAudio: audioFilename,
    detectedLanguage: detectedLanguage || null,
    transcript: transcription.text,
    summary,
    enhancedText,
    comparisonMethod:
      "OpenAI transcribes each generated MP3; normalized word/segment edit distance against enhanced text is reported as fidelity.",
    comparisons,
  };
  await Promise.all([
    writeFile(
      path.join(runDirectory, "comparison.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(runDirectory, "report.html"),
      buildReport({
        audioFilename,
        language: detectedLanguage,
        transcript: transcription.text,
        summary,
        enhancedText,
        comparisons,
      }),
      "utf8",
    ),
  ]);

  const best = comparisons.reduce((currentBest, current) =>
    current.fidelityScore > currentBest.fidelityScore ? current : currentBest,
  );
  console.log(`Best transcript fidelity: ${best.provider} (${best.fidelityScore}/100).`);
  console.log(`Results saved to: ${runDirectory}`);
}

async function main() {
  const { audioPath: argumentPath, language } = parseArguments(process.argv.slice(2));
  let audioPath = argumentPath;
  if (!audioPath) {
    const terminal = readline.createInterface({ input: stdin, output: stdout });
    try {
      audioPath = (await terminal.question("Path to an audio file: ")).trim();
    } finally {
      terminal.close();
    }
  }
  if (!audioPath) {
    throw new Error("Audio file path cannot be empty.");
  }
  await createContent(audioPath, language);
}

main().catch((error) => {
  console.error(`\nError: ${error.message}`);
  process.exitCode = 1;
});
