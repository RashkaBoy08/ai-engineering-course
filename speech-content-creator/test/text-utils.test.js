import assert from "node:assert/strict";
import test from "node:test";
import { compareText, splitTextIntoChunks } from "../text-utils.js";

test("splits long text without losing characters or exceeding the limit", () => {
  const text = "one two three four five six seven eight nine ten";
  const chunks = splitTextIntoChunks(text, 12);

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 12));
  assert.equal(chunks.join(""), text);
});

test("splits long unbroken text without breaking Unicode characters", () => {
  const text = "🌌".repeat(12);
  const chunks = splitTextIntoChunks(text, 1);

  assert.ok(chunks.every((chunk) => [...chunk].length <= 1));
  assert.equal(chunks.join(""), text);
});

test("rejects invalid chunk limits", () => {
  assert.throws(() => splitTextIntoChunks("text", 0), /positive integer/);
});

test("compares generated speech text case-insensitively", () => {
  const result = compareText("Hello, world!", "hello world");

  assert.equal(result.errors, 0);
  assert.equal(result.fidelityScore, 100);
});

test("reports substitutions in generated speech text", () => {
  const result = compareText("hello world", "hello there");

  assert.equal(result.errors, 1);
  assert.equal(result.errorRate, 0.5);
  assert.equal(result.fidelityScore, 50);
});
