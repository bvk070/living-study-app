import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface ParsedSentence {
  text: string;
  subheading: string | null;
  documentOrder: number;
}

export interface ParsedSection {
  title: string;
  sectionOrder: number;
  sentences: ParsedSentence[];
}

interface PdfLine {
  text: string;
  bold: boolean;
  hasFontData: boolean;
}

const FOOTER_TITLE = /mobile\s+system\s+design\s*-\s*study\s+notes/i;
const PAGE_NUMBER = /^(?:page\s*)?\d+(?:\s*(?:of|\/)\s*\d+)?$/i;
const SECTION_HEADING = /^\s*(\d+)\.\s+(.+?)\s*$/;
const SENTENCE_SEGMENTER = new Intl.Segmenter("en", { granularity: "sentence" });

function makeLines(items: Array<{ str?: string; fontName?: string; hasEOL?: boolean }>, styles: Record<string, { fontFamily?: string; fontWeight?: number }>): PdfLine[] {
  const lines: PdfLine[] = [];
  let text = "";
  let boldCharacters = 0;
  let totalCharacters = 0;
  let hasFontData = false;

  const flush = () => {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (normalized) {
      lines.push({
        text: normalized,
        bold: totalCharacters > 0 && boldCharacters / totalCharacters >= 0.8,
        hasFontData,
      });
    }
    text = "";
    boldCharacters = 0;
    totalCharacters = 0;
    hasFontData = false;
  };

  for (const item of items) {
    if (typeof item.str !== "string") continue;
    const style = item.fontName ? styles[item.fontName] : undefined;
    if (item.fontName || style) hasFontData = true;
    const fontLabel = `${item.fontName ?? ""} ${style?.fontFamily ?? ""}`;
    const isBold = /bold|semibold|demi|black/i.test(fontLabel) || (style?.fontWeight ?? 0) >= 600;
    totalCharacters += item.str.length;
    if (isBold) boldCharacters += item.str.length;
    text += item.str;
    if (item.hasEOL) flush();
  }
  flush();
  return lines;
}

function isRunningMatter(line: string): boolean {
  return FOOTER_TITLE.test(line) || PAGE_NUMBER.test(line);
}

function splitSentences(text: string): string[] {
  return Array.from(SENTENCE_SEGMENTER.segment(text))
    .map((part) => part.segment.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/**
 * Extracts sectioned text while removing repeated page furniture. Body lines are
 * joined with spaces before sentence segmentation, so PDF line wraps never
 * become sentence boundaries.
 */
export async function parseStudyPdf(bytes: Uint8Array): Promise<{ pageCount: number; sections: ParsedSection[] }> {
  const pdf = await getDocument({
    data: bytes,
    useSystemFonts: true,
    disableFontFace: true,
  }).promise;

  if (pdf.numPages < 1 || pdf.numPages > 20) {
    throw new Error("PDF must contain between 1 and 20 pages.");
  }

  const pages: PdfLine[][] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const styles = content.styles as Record<string, { fontFamily?: string; fontWeight?: number }>;
    const items = content.items.filter(
      (item): item is typeof item & { str: string } => "str" in item && typeof item.str === "string",
    );
    pages.push(makeLines(items, styles));
  }

  const hasBoldMetadata = pages.flat().some((line) => line.hasFontData);
  const hasRecognizableBold = pages.flat().some((line) => line.bold);
  const useBoldForSubheadings = hasBoldMetadata && hasRecognizableBold;
  const sections: ParsedSection[] = [];
  let activeSection: ParsedSection | undefined;
  let activeSubheading: string | null = null;
  let bodyLines: string[] = [];
  let documentOrder = 0;

  const flushBody = () => {
    if (!activeSection || bodyLines.length === 0) {
      bodyLines = [];
      return;
    }
    const mergedBody = bodyLines.join(" ").replace(/\s+/g, " ").trim();
    for (const sentence of splitSentences(mergedBody)) {
      activeSection.sentences.push({
        text: sentence,
        subheading: activeSubheading,
        documentOrder,
      });
      documentOrder += 1;
    }
    bodyLines = [];
  };

  for (const pageLines of pages) {
    for (const line of pageLines) {
      const text = line.text.trim();
      if (!text || isRunningMatter(text)) continue;

      const sectionMatch = text.match(SECTION_HEADING);
      if (sectionMatch) {
        flushBody();
        activeSection = {
          title: text,
          sectionOrder: Number(sectionMatch[1]),
          sentences: [],
        };
        sections.push(activeSection);
        activeSubheading = null;
        continue;
      }

      if (!activeSection) continue;

      const shortHeading =
        text.length <= 70 &&
        text.split(/\s+/).length <= 10 &&
        !/[.!?:;]$/.test(text) &&
        !/^[•●▪–—-]\s/.test(text);
      const isSubheading = shortHeading && (useBoldForSubheadings ? line.bold : true);
      if (isSubheading) {
        flushBody();
        activeSubheading = text;
        continue;
      }

      bodyLines.push(text);
    }
  }
  flushBody();

  const nonEmptySections = sections.filter((section) => section.sentences.length > 0);
  if (nonEmptySections.length === 0) {
    throw new Error("No numbered sections with readable text were found in this PDF.");
  }
  return { pageCount: pdf.numPages, sections: nonEmptySections };
}
