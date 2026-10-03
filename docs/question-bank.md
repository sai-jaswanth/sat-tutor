# Question Bank

The bulk bank follows the current Digital SAT content-domain structure published by College Board.

## Math domains
- Algebra
- Advanced Math
- Problem-Solving and Data Analysis
- Geometry and Trigonometry

## Reading and Writing domains
- Information and Ideas
- Craft and Structure
- Expression of Ideas
- Standard English Conventions

`npm run seed:bulk` generates 1,200 original SAT-style practice questions:
- 800 Math (20 skills × 5 difficulty levels × 8 variants)
- 400 Reading & Writing (10 skills × 5 difficulty levels × 8 variants)

Each skill's 40 rows (5 difficulties × 8 variants) are generated so that every
numeric/scenario parameter is derived from a unique index within that block —
this guarantees the 40 questions in a skill are genuinely distinct items
rather than the same stem relabeled at five different "difficulty" levels
(an earlier version of this generator had that bug for several skills; see
`npm run questions:validate` below).

Every generated question has:
- `section`
- `domain`
- `skill`
- `difficulty` (1–5)
- `frequency_tier`
- `concept_tags`
- `source=bulk_original`
- `validated=1`
- `status=approved`

## Frequency metadata
`frequency_tier` is a qualitative topic-frequency label based on the published SAT domain distribution. It is **not** a claim that a specific item appeared on a prior SAT exam.

The database also contains:
- `previous_exam_occurrence_count`
- `previous_exam_occurrence_basis`

These fields stay `NULL` for original generated questions. Populate them only with verified, legally usable prior-exam source data.

## Validation

Run `npm run questions:validate` to check the whole bank for reliability
issues before trusting it in production:
- duplicate stems within the same skill (the bug described above)
- MCQ `correct_answer` must match one of the rendered choices
- grid-in `correct_answer` must be numeric (or a simple fraction)
- non-trivial stem/explanation text
- valid `difficulty` (1–5), `section`, and `status`

It exits non-zero on any hard error, so it can gate CI or a deploy pipeline.
`npm test` runs it automatically after the web and MCP smoke tests.

Import verified occurrence data with:

```bash
npm run questions:occurrence -- path/to/occurrence.csv
```

CSV format:

```csv
question_id,occurrence_count,basis
q_123,3,"Verified source corpus"
```

Use `npm run questions:backfill` once for the original 8 seed questions, then `npm run questions:count` to inspect coverage.


## Practice and Admin UI
The web app now provides practice filters for section, domain, skill, difficulty, and topic-frequency tier. Each practice result shows the submitted answer, verified correct answer, time, hints used, explanation, mastery update, and next review time.

The admin Question Bank view supports search, filtering, question creation/editing, approval, and archiving. Previous-exam occurrence counts are treated as verified metadata only; generated/original questions are never presented as real past-exam questions unless occurrence data has been explicitly imported from a verified source corpus.
