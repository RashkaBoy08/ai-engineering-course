import "dotenv/config";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { toFile } from "openai/uploads";

const appDirectory = path.dirname(fileURLToPath(import.meta.url));
const outputDirectory = path.join(appDirectory, "output");
let openai;

function requireApiKeys() {
  const missing = [
    ["OPENAI_API_KEY", process.env.OPENAI_API_KEY],
    ["REPLICATE_API_TOKEN", process.env.REPLICATE_API_TOKEN],
    ["FAL_KEY", process.env.FAL_KEY],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`Missing required API key(s): ${missing.join(", ")}.`);
  }
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function slugify(value) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "art-gallery"
  );
}

function safeFilename(value) {
  return slugify(value).replace(/-/g, "_");
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function responseJson(response, service) {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${service} request failed (${response.status}): ${body}`);
  }
  return response.json();
}

async function downloadImage(url, service) {
  const imageUrl = new URL(url);
  if (imageUrl.protocol !== "https:") {
    throw new Error(`${service} returned a non-HTTPS image URL.`);
  }

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`${service} image download failed (${response.status}).`);
  }

  const mimeType = response.headers.get("content-type")?.split(";")[0];
  if (!mimeType?.startsWith("image/")) {
    throw new Error(`${service} returned a response that is not an image.`);
  }

  return { buffer: Buffer.from(await response.arrayBuffer()), mimeType };
}

function extensionFor(mimeType) {
  const extensions = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  const extension = extensions[mimeType];
  if (!extension) {
    throw new Error(`Unsupported image format: ${mimeType}.`);
  }
  return extension;
}

async function generateWithOpenAI(prompt) {
  const response = await openai.images.generate({
    model: "gpt-image-1",
    prompt,
    size: "1024x1024",
    quality: "medium",
    output_format: "png",
  });
  const imageData = response.data?.[0]?.b64_json;
  if (!imageData) {
    throw new Error("OpenAI did not return image data.");
  }
  return { buffer: Buffer.from(imageData, "base64"), mimeType: "image/png" };
}

async function generateVariationFromBest(image, prompt) {
  const response = await openai.images.edit({
    model: "gpt-image-1",
    image: await toFile(image.buffer, image.filename, { type: image.mimeType }),
    prompt,
    size: "1024x1024",
    quality: "medium",
    output_format: "png",
  });
  const imageData = response.data?.[0]?.b64_json;
  if (!imageData) {
    throw new Error("OpenAI did not return a variation image.");
  }
  return { buffer: Buffer.from(imageData, "base64"), mimeType: "image/png" };
}

async function generateWithReplicate(prompt) {
  const response = await fetch(
    "https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
        Prefer: "wait=60",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: {
          prompt,
          aspect_ratio: "1:1",
          output_format: "png",
          num_outputs: 1,
        },
      }),
    },
  );
  let prediction = await responseJson(response, "Replicate");

  if (prediction.status !== "succeeded" && prediction.status !== "failed") {
    const statusUrl = prediction.urls?.get ?? prediction.status_url;
    if (!statusUrl) {
      throw new Error("Replicate did not provide a prediction status URL.");
    }

    for (let attempt = 0; attempt < 30; attempt += 1) {
      await sleep(2000);
      const statusResponse = await fetch(statusUrl, {
        headers: {
          Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
        },
      });
      prediction = await responseJson(statusResponse, "Replicate");
      if (prediction.status === "succeeded" || prediction.status === "failed") {
        break;
      }
    }
  }

  if (prediction.status !== "succeeded") {
    throw new Error(
      `Replicate image generation did not succeed: ${prediction.error ?? prediction.status}.`,
    );
  }

  const imageUrl = Array.isArray(prediction.output)
    ? prediction.output[0]
    : prediction.output;
  if (typeof imageUrl !== "string") {
    throw new Error("Replicate did not return an image URL.");
  }
  return downloadImage(imageUrl, "Replicate");
}

async function generateWithFal(prompt) {
  const response = await fetch("https://fal.run/fal-ai/flux/schnell", {
    method: "POST",
    headers: {
      Authorization: `Key ${process.env.FAL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      image_size: "square_hd",
      num_images: 1,
      output_format: "png",
    }),
  });
  const result = await responseJson(response, "fal.ai");
  const imageUrl = result.images?.[0]?.url;
  if (typeof imageUrl !== "string") {
    throw new Error("fal.ai did not return an image URL.");
  }
  return downloadImage(imageUrl, "fal.ai");
}

async function saveImage(directory, theme, name, image) {
  const filename = `${safeFilename(theme)}-${name}.${extensionFor(image.mimeType)}`;
  await writeFile(path.join(directory, filename), image.buffer);
  return {
    ...image,
    filename,
    dataUrl: `data:${image.mimeType};base64,${image.buffer.toString("base64")}`,
  };
}

async function compareImages(theme, images) {
  const imageParts = images.map((image) => ({
    type: "image_url",
    image_url: { url: image.dataUrl, detail: "low" },
  }));
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              `Compare these images generated for the theme "${theme}". ` +
              "Score each from 0 to 100 for visual quality, relevance to the theme, " +
              "composition, and clarity. Return JSON with an `images` array in the " +
              `same order, each item containing a numeric score and a brief reason. ` +
              `Provider order: ${images.map((image) => image.provider).join(", ")}.`,
          },
          ...imageParts,
        ],
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI quality comparison returned no result.");
  }

  let comparison;
  try {
    comparison = JSON.parse(content);
  } catch {
    throw new Error("OpenAI quality comparison returned invalid JSON.");
  }

  if (!Array.isArray(comparison.images) || comparison.images.length !== images.length) {
    throw new Error("OpenAI quality comparison returned an unexpected number of scores.");
  }

  return images.map((image, index) => {
    const result = comparison.images[index];
    if (
      typeof result?.score !== "number" ||
      result.score < 0 ||
      result.score > 100 ||
      typeof result.reason !== "string"
    ) {
      throw new Error(`OpenAI returned an invalid quality score for ${image.provider}.`);
    }
    return { ...image, score: result.score, reason: result.reason };
  });
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function galleryHtml(theme, scoredImages, variations) {
  const bestImage = scoredImages.reduce((best, image) =>
    image.score > best.score ? image : best,
  );
  const imageCard = (image, label) => `
    <article class="card">
      <img src="${escapeHtml(image.filename)}" alt="${escapeHtml(label)}">
      <div class="details">
        <h2>${escapeHtml(label)}</h2>
        <p>${escapeHtml(image.provider)}</p>
        ${image.score === undefined ? "" : `<p><strong>Quality score:</strong> ${image.score}/100</p>`}
        ${image.reason ? `<p>${escapeHtml(image.reason)}</p>` : ""}
      </div>
    </article>`;
  const originalCards = scoredImages
    .map((image) =>
      imageCard(
        image,
        image === bestImage ? `${image.provider} — Best result` : image.provider,
      ),
    )
    .join("");
  const variationCards = variations
    .map((image, index) => imageCard(image, `Variation ${index + 1}`))
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AI Art Gallery — ${escapeHtml(theme)}</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, sans-serif; }
    body { margin: 0; padding: 2rem; background: #f4f4f5; color: #18181b; }
    main { max-width: 1100px; margin: auto; }
    h1 { margin-bottom: .4rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem; }
    .card { overflow: hidden; border-radius: 12px; background: white; box-shadow: 0 2px 8px #0001; }
    .card img { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; background: #e4e4e7; }
    .details { padding: 1rem; }
    .details h2 { margin: 0 0 .4rem; font-size: 1.1rem; }
    .details p { margin: .35rem 0; }
  </style>
</head>
<body>
  <main>
    <h1>AI Art Gallery</h1>
    <p>Theme: ${escapeHtml(theme)}</p>
    <h2>Provider comparison</h2>
    <section class="grid">${originalCards}
    </section>
    <h2>Variations from the best provider (${escapeHtml(bestImage.provider)})</h2>
    <section class="grid">${variationCards}
    </section>
  </main>
</body>
</html>`;
}

async function createGallery(theme) {
  requireApiKeys();

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const galleryDirectory = path.join(
    outputDirectory,
    `${slugify(theme)}-${timestamp}`,
  );
  await mkdir(galleryDirectory, { recursive: true });

  const providers = [
    ["OpenAI", generateWithOpenAI],
    ["Replicate", generateWithReplicate],
    ["fal.ai", generateWithFal],
  ];

  console.log("Generating one image with each provider...");
  const outcomes = await Promise.allSettled(
    providers.map(async ([provider, generate]) => {
      const image = await generate(theme);
      return saveImage(galleryDirectory, theme, safeFilename(provider), {
        ...image,
        provider,
      });
    }),
  );
  const failures = outcomes
    .map((outcome, index) => ({ outcome, provider: providers[index][0] }))
    .filter(({ outcome }) => outcome.status === "rejected");
  if (failures.length > 0) {
    const details = failures
      .map(({ outcome, provider }) => `${provider}: ${outcome.reason.message}`)
      .join("\n");
    throw new Error(`Image generation failed:\n${details}`);
  }

  const generatedImages = outcomes.map((outcome) => outcome.value);
  console.log("Comparing image quality with OpenAI...");
  const scoredImages = await compareImages(theme, generatedImages);
  const bestImage = scoredImages.reduce((best, image) =>
    image.score > best.score ? image : best,
  );

  const variationPrompts = [
    `Create a variation of this image for the theme "${theme}". Preserve its main subject and visual idea (${bestImage.reason}), but use a different camera angle and lighting.`,
    `Create another variation of this image for the theme "${theme}". Preserve its main subject and visual idea (${bestImage.reason}), but change the color palette and composition.`,
  ];
  console.log(`Creating two image-based variations from ${bestImage.provider}'s result...`);
  const variations = await Promise.all(
    variationPrompts.map(async (prompt, index) => {
      const image = await generateVariationFromBest(bestImage, prompt);
      return saveImage(galleryDirectory, theme, `variation-${index + 1}`, {
        ...image,
        provider: `OpenAI image edit (source: ${bestImage.provider})`,
      });
    }),
  );

  await writeFile(
    path.join(galleryDirectory, "index.html"),
    galleryHtml(theme, scoredImages, variations),
    "utf8",
  );
  console.log(`Best result: ${bestImage.provider} (${bestImage.score}/100).`);
  console.log(`Gallery saved to: ${path.join(galleryDirectory, "index.html")}`);
}

async function main() {
  let theme = process.argv.slice(2).join(" ").trim();
  if (!theme) {
    const terminal = readline.createInterface({ input: stdin, output: stdout });
    try {
      theme = (await terminal.question("Enter an art theme: ")).trim();
    } finally {
      terminal.close();
    }
  }

  if (!theme) {
    throw new Error("Theme cannot be empty.");
  }
  await createGallery(theme);
}

main().catch((error) => {
  console.error(`\nError: ${error.message}`);
  process.exitCode = 1;
});
