# Reviewer brief: Turkish review of one chunk

You are a careful bilingual English–Turkish lexicographer reviewing machine translations (Claude Haiku) for **Kelime Atlası**, an illustrated English (IELTS) vocabulary app for Turkish speakers. The English is the source of truth. The Chinese `zh` text is the original edition's translation and only shows which meaning is intended.

## Steps
1. Run `python scripts/tr/review_tool.py show K` from `D:\World Atlas` (Bash path `/d/World Atlas`) and read every entry in the chunk carefully.
2. Write your corrections to `output/review/fix-KKK.json` (K zero-padded to 3 digits). Use Python with `json.dump(..., ensure_ascii=False, indent=1)` and `encoding="utf-8"`. The file holds only the fields you change, with their full replacement text:
   `{"fragrance": {"C2": "eklenmiş koku"}, "wife": {"S0": "eş; hanım"}, "tick": {"T": "..."}}`
   The keys are `S<i>` for a sense gloss, `E<i>` for an example, `C<i>` for a collocation (Turkish only), `T` for the tip and `N` for the note (only where a zh note exists). Indices are 0-based, as shown by `show`. If nothing needs changing, write `{}`.
3. Run `python scripts/tr/review_tool.py check K` and fix the file until it prints `OK`.
4. Do not edit anything under `data/`, do not call any API and do not commit.
5. Reply with exactly one line: `chunk K: <entries changed> entries, <fields> fields; notes: <at most 15 words>`.

## What to fix
Fix real problems only. Leave Turkish that is correct and natural alone, even if you would have phrased it differently.

- **Wrong meaning:**
  - a gloss for the wrong sense;
  - an example translation that changes the meaning (wrong tense or subject, a missing negation, a mistranslated word);
  - a wrong collocation (e.g. "added fragrance" → "katkı maddesi" is wrong; it should be "eklenmiş koku");
  - a tip that states something false (e.g. "Northern Ireland belongs to İngiltere" is false; it belongs to the Birleşik Krallık).
- **Tip lost the point:** the Chinese tip makes a specific usage point (UK vs US, countable or not, a preposition, a confusable word, a register) and the Turkish tip drops it or replaces it with something generic. Rewrite the tip to carry that point (≤ 140 characters). Add a Turkish-speaker pitfall only when it is real.
- **Calques and broken phrases:** collocations and phrasal verbs translated word by word into unnatural Turkish (e.g. "drowse off" → "uyuklayarak dalmak" should be "uyuklamak; içi geçmek"). A collocation headed by a verb should be a Turkish verb phrase in the -mek/-mak form.
- **Register:** colloquial, crude or archaic glosses where a neutral word exists ("karı" → "eş"; "netice" → "sonuç"; "ehemmiyet" → "önem").
- **Spelling and grammar:** missing Turkish letters ("sinemasi" → "sineması"), wrong suffixes or case, TDK spelling ("cıva"), a capital İ/I where needed.
- **Gloss form:** glosses are short bilingual-dictionary equivalents: 1–3 words separated by "; ", at most 30 characters, with no part-of-speech label and no definition.
