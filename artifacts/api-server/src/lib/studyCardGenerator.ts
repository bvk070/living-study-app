import { openai } from "@workspace/integrations-openai-ai-server";

export interface SectionSentence {
  id: string;
  text: string;
}

export interface GeneratedCard {
  kind: "flashcard" | "quiz";
  front: string;
  answer: string;
  quizOptions: string[];
  correctAnswer: string | null;
  sourceSentenceIds: string[];
}

export class InvalidModelJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidModelJsonError";
  }
}

function parseItems(raw: string): unknown[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new InvalidModelJsonError("The response must be a JSON list.");
  }
  return parsed;
}

function normalizeItem(value: unknown, validSourceIds: Set<string>): GeneratedCard | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const kind = item.type;
  const front = typeof item.front === "string" ? item.front : item.question;
  const answer = typeof item.back === "string" ? item.back : item.answer;
  const sourceIds = item.source_sentence_ids;
  if (
    (kind !== "flashcard" && kind !== "quiz") ||
    typeof front !== "string" ||
    !front.trim() ||
    typeof answer !== "string" ||
    !answer.trim() ||
    !Array.isArray(sourceIds) ||
    sourceIds.length < 1 ||
    sourceIds.length > 2 ||
    !sourceIds.every((id) => typeof id === "string" && validSourceIds.has(id))
  ) {
    return null;
  }

  if (kind === "flashcard") {
    return {
      kind,
      front: front.trim(),
      answer: answer.trim(),
      quizOptions: [],
      correctAnswer: null,
      sourceSentenceIds: sourceIds as string[],
    };
  }

  if (!Array.isArray(item.options) || item.options.length !== 4) return null;
  const options: string[] = [];
  let correctAnswer: string | null = null;
  for (const option of item.options) {
    if (typeof option !== "object" || option === null || Array.isArray(option)) return null;
    const optionRecord = option as Record<string, unknown>;
    if (typeof optionRecord.text !== "string" || !optionRecord.text.trim()) return null;
    if (typeof optionRecord.correct !== "boolean") return null;
    options.push(optionRecord.text.trim());
    if (optionRecord.correct) {
      if (correctAnswer !== null) return null;
      correctAnswer = optionRecord.text.trim();
    }
  }
  if (correctAnswer === null) return null;

  return {
    kind,
    front: front.trim(),
    answer: answer.trim(),
    quizOptions: options,
    correctAnswer,
    sourceSentenceIds: sourceIds as string[],
  };
}

export async function generateSectionCards(sentences: SectionSentence[]): Promise<GeneratedCard[]> {
  const numberedSentences = sentences.map((sentence) => ({
    id: sentence.id,
    text: sentence.text,
  }));
  const sourceIds = new Set(sentences.map((sentence) => sentence.id));
  const systemPrompt = [
    "Create study flashcards and quiz questions using only the supplied sentences.",
    "Keep every condition, platform, scope limitation, and qualifier exactly grounded in the cited source.",
    "Skip sentences rather than guess. Do not use outside knowledge.",
    "Use 1 or 2 source_sentence_ids from this section for each item.",
    "Return ONLY a valid JSON array, with no markdown or prose.",
    "Flashcard item: {\"type\":\"flashcard\",\"front\":\"...\",\"back\":\"...\",\"source_sentence_ids\":[\"...\"]}.",
    "Quiz item: {\"type\":\"quiz\",\"question\":\"...\",\"answer\":\"...\",\"options\":[{\"text\":\"...\",\"correct\":true},{\"text\":\"...\",\"correct\":false},{\"text\":\"...\",\"correct\":false},{\"text\":\"...\",\"correct\":false}],\"source_sentence_ids\":[\"...\"]}.",
    "Each quiz has exactly four options and exactly one option marked correct. Distractors must be plausible but clearly contradicted by these notes.",
  ].join(" ");

  let previousRaw = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const messages = [
      { role: "system" as const, content: systemPrompt },
      {
        role: "user" as const,
        content:
          attempt === 0
            ? JSON.stringify(numberedSentences)
            : `Your previous response was not a valid JSON array. Return only one valid JSON array matching the instructions. Do not add markdown. Invalid response: ${previousRaw}`,
      },
    ];
    const completion = await openai.chat.completions.create({
      model: "gpt-5.6-terra",
      max_completion_tokens: 8192,
      messages,
    });
    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    try {
      const parsedItems = parseItems(raw);
      return parsedItems
        .map((item) => normalizeItem(item, sourceIds))
        .filter((item): item is GeneratedCard => item !== null);
    } catch (error) {
      if (!(error instanceof InvalidModelJsonError) && !(error instanceof SyntaxError)) throw error;
      previousRaw = raw;
      if (attempt === 1) {
        throw new InvalidModelJsonError("The model returned invalid JSON twice.");
      }
    }
  }
  throw new InvalidModelJsonError("The model returned invalid JSON twice.");
}
