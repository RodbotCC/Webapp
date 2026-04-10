# Andre Language Map

- Generated: 2026-04-09T01:51:55.094434+00:00
- Unique Andre calls: 111
- Andre utterances: 2395
- Andre sentences: 5101

## Files

- `andre_calls_canonical.csv`: one row per unique Andre call
- `andre_utterances.csv`: Andre-only utterance table
- `andre_sentences.csv`: sentence-split Andre language table with heuristic intent tags
- `andre_repeated_phrases.csv`: repeated 2-5 token phrases from Andre's speech
- `andre_sentence_starters.csv`: recurring sentence openings
- `andre_top_content_words.csv`: non-trivial vocabulary frequency
- `andre_intent_summary.csv`: rough intent distribution

## Notes

- Duplicate indexed views of the same call were collapsed by `call_id`.
- Canonical call paths prefer `by_lead`, then `by_contact`, then `by_salesperson` style directories when available.
- Intent tags are heuristic and meant for exploration, not perfect truth.
