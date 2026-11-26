/**
 * Garbled output detection tests (#6004)
 */
import { describe, expect, it } from "vitest";

// Import the function from route.ts - we'll need to export it
// For now, inline the detection logic for testing

function detectGarbledOutput(answer: string, conversationLanguages: string[] = ["en"]): { garbled: boolean; reason?: string } {
  const latinConvo = conversationLanguages.every(lang => ["en", "es", "fr", "de", "it", "pt"].includes(lang));
  if (latinConvo) {
    if (/[\u0900-\u097F]/.test(answer)) {
      return { garbled: true, reason: "Devanagari text in Latin-script conversation" };
    }
    if (/[\u0600-\u06FF]/.test(answer)) {
      return { garbled: true, reason: "Arabic text in Latin-script conversation" };
    }
    if (/[\u0400-\u04FF]/.test(answer)) {
      return { garbled: true, reason: "Cyrillic text in Latin-script conversation" };
    }
    if (/[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]/.test(answer)) {
      return { garbled: true, reason: "CJK text in Latin-script conversation" };
    }
  }
  
  const draftMarkers = [
    /better (spanish|english|french|german):/i,
    /rewrite:/i,
    /correction:/i,
    /let me (rephrase|correct|fix|rewrite)/i,
    /wait,? (let me|i should)/i,
    /actually,? (let me|i should)/i
  ];
  for (const pattern of draftMarkers) {
    if (pattern.test(answer)) {
      return { garbled: true, reason: `Draft marker found: ${pattern.source}` };
    }
  }
  
  return { garbled: false };
}

describe("detectGarbledOutput", () => {
  describe("mixed-script detection", () => {
    it("flags Devanagari in English answer", () => {
      const answer = "No puedo पुछि? better Spanish: No puedo confirmar...";
      const result = detectGarbledOutput(answer, ["en"]);
      expect(result.garbled).toBe(true);
      expect(result.reason).toContain("Devanagari");
    });

    it("flags Devanagari in Spanish answer", () => {
      const answer = "El LED está पुष्टि encendido en amarillo.";
      const result = detectGarbledOutput(answer, ["es"]);
      expect(result.garbled).toBe(true);
      expect(result.reason).toContain("Devanagari");
    });

    it("flags Arabic in English answer", () => {
      const answer = "The drive shows fault مشكلة F004.";
      const result = detectGarbledOutput(answer, ["en"]);
      expect(result.garbled).toBe(true);
      expect(result.reason).toContain("Arabic");
    });

    it("flags Cyrillic in English answer", () => {
      const answer = "The parameter Ошибка is not set.";
      const result = detectGarbledOutput(answer, ["en"]);
      expect(result.garbled).toBe(true);
      expect(result.reason).toContain("Cyrillic");
    });

    it("flags CJK in English answer", () => {
      const answer = "The fault code 错误 means overcurrent.";
      const result = detectGarbledOutput(answer, ["en"]);
      expect(result.garbled).toBe(true);
      expect(result.reason).toContain("CJK");
    });

    it("does not flag clean English answer", () => {
      const answer = "F004 is an overcurrent fault. Check the motor cable for shorts [1].";
      const result = detectGarbledOutput(answer, ["en"]);
      expect(result.garbled).toBe(false);
    });

    it("does not flag clean Spanish answer", () => {
      const answer = "El LED amarillo indica que el CPU está en modo STOP [1].";
      const result = detectGarbledOutput(answer, ["es"]);
      expect(result.garbled).toBe(false);
    });
  });

  describe("draft marker detection", () => {
    it("flags 'better Spanish:' meta-comment", () => {
      const answer = "No puedo? better Spanish: No puedo confirmar...";
      const result = detectGarbledOutput(answer);
      expect(result.garbled).toBe(true);
      expect(result.reason).toContain("Draft marker");
    });

    it("flags 'better English:' meta-comment", () => {
      const answer = "not sure, better english: The drive is in fault mode.";
      const result = detectGarbledOutput(answer);
      expect(result.garbled).toBe(true);
    });

    it("flags 'rewrite:' meta-comment", () => {
      const answer = "Fault detected. rewrite: The drive shows F004 overcurrent fault.";
      const result = detectGarbledOutput(answer);
      expect(result.garbled).toBe(true);
    });

    it("flags 'let me rephrase' self-correction", () => {
      const answer = "The LED means... let me rephrase: The yellow LED indicates STOP mode.";
      const result = detectGarbledOutput(answer);
      expect(result.garbled).toBe(true);
    });

    it("flags 'wait, let me' self-correction", () => {
      const answer = "F081 is not found. Wait, let me check again - it's on page 162.";
      const result = detectGarbledOutput(answer);
      expect(result.garbled).toBe(true);
    });

    it("flags 'actually, i should' self-correction", () => {
      const answer = "No information found. Actually, I should check the table - F081 is Type 2.";
      const result = detectGarbledOutput(answer);
      expect(result.garbled).toBe(true);
    });

    it("does not flag normal use of 'wait' or 'actually' in instructions", () => {
      const answer = "Wait 5 minutes for the DC bus to discharge. Actually test with a meter before touching terminals [1].";
      const result = detectGarbledOutput(answer);
      expect(result.garbled).toBe(false);
    });

    it("does not flag normal 'better' in comparison context", () => {
      const answer = "Using shielded cable is better than unshielded for long runs [1].";
      const result = detectGarbledOutput(answer);
      expect(result.garbled).toBe(false);
    });
  });

  describe("combined issues", () => {
    it("flags answer with both mixed script and draft marker", () => {
      const answer = "No puedo पुछि? better Spanish: No puedo confirmar que el BAT.STATUS rojo sea el fuse.";
      const result = detectGarbledOutput(answer, ["es"]);
      expect(result.garbled).toBe(true);
      // Should catch either issue
      expect(result.reason).toBeTruthy();
    });
  });
});
