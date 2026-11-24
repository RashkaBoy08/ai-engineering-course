export function splitTextIntoChunks(text, maxLength = 3800) {
  if (!Number.isInteger(maxLength) || maxLength < 1) {
    throw new Error("Chunk length must be a positive integer.");
  }

  const chunks = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
  let current = "";
  let currentLength = 0;

  for (const { segment } of segmenter.segment(text)) {
    const segmentLength = Array.from(segment).length;
    if (currentLength + segmentLength > maxLength && current) {
      chunks.push(current);
      current = "";
      currentLength = 0;
    }

    if (segmentLength <= maxLength) {
      current += segment;
      currentLength += segmentLength;
      continue;
    }

    for (const character of segment) {
      if (currentLength + 1 > maxLength && current) {
        chunks.push(current);
        current = "";
        currentLength = 0;
      }
      current += character;
      currentLength += 1;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function tokenize(text) {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
  return [...segmenter.segment(text.normalize("NFKC").toLocaleLowerCase())]
    .filter((segment) => segment.isWordLike)
    .map((segment) => segment.segment);
}

export function compareText(referenceText, generatedText) {
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
