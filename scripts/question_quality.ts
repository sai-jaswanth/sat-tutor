type QuestionContent = {
  section?: unknown;
  stem?: unknown;
  choices?: unknown;
  answer_type?: unknown;
  correct_answer?: unknown;
};

const extractionArtifacts = /[�□■]|\.{18,}|[-=~^_]{8,}/;
const flattenedMathNotation = /\b[a-z]\s+\d+\s*(?:[,?]|if\b|where\b|and\b)|\b\d+\s+[a-z]\s*\d+\b/i;
const flattenedExponent = /\)\s*[a-z]\s*(?:[+-]\s*\d+|\d+)\b/i;

export function normalizeQuestionStem(raw:string): string {
  return String(raw || '').trim()
    .replace(/\btheblank\b/gi, 'the blank')
    .replace(/\bblank\s*([;,.:?])/gi, '______$1')
    .replace(/\s+([;,.:?!])/g, '$1');
}

export function questionQualityIssues(question: QuestionContent): string[] {
  const issues: string[] = [];
  const section = String(question.section || '').trim();
  const stem = normalizeQuestionStem(String(question.stem || ''));
  const answerType = String(question.answer_type || '').trim().toLowerCase();
  const correctAnswer = String(question.correct_answer || '').trim();
  const choices = Array.isArray(question.choices) ? question.choices.map(choice => String(choice ?? '').trim()) : [];

  if (!['math', 'reading_writing'].includes(section)) issues.push('unknown section');
  if (stem.length < 20) issues.push('question text is missing or too short');
  if (stem.length > 3500) issues.push('question text is too long to be a single SAT item');
  if (extractionArtifacts.test(stem)) issues.push('question text contains PDF extraction artifacts');
  if (/\bblank\s+Which choice\b/i.test(stem)) issues.push('an unfinished blank marker is mixed into the prompt');
  if (/\bA\)\s[\s\S]{20,500}\bB\)\s[\s\S]{20,500}\bC\)/.test(stem)) issues.push('answer choices appear concatenated into the question text');
  if (section === 'math' && (flattenedMathNotation.test(stem) || flattenedExponent.test(stem))) issues.push('math notation appears flattened or separated by PDF extraction');

  if (answerType === 'mcq') {
    if (choices.length !== 4) issues.push(`multiple-choice item has ${choices.length} options instead of 4`);
    if (choices.some(choice => !choice)) issues.push('one or more answer options are empty');
    if (choices.some(choice => choice.length > 650 || extractionArtifacts.test(choice))) issues.push('answer options contain extraction artifacts');
    if (section === 'math' && choices.some(choice => flattenedMathNotation.test(choice) || flattenedExponent.test(choice))) issues.push('math answer options contain flattened notation');
    if (!/^[A-D]$/i.test(correctAnswer)) issues.push('answer key is not a valid option letter');
  } else if (answerType === 'grid_in' || answerType === 'grid-in') {
    if (choices.length) issues.push('grid-in item unexpectedly contains options');
    if (!correctAnswer) issues.push('grid-in answer is missing');
    else if (!/^-?(?:\d+(?:\.\d+)?|\d+\/\d+)$/.test(correctAnswer)) issues.push('grid-in answer is not numeric or a simple fraction');
  } else {
    issues.push('answer type is unknown');
  }

  return [...new Set(issues)];
}