# Learning model

## Daily session

- **Reviews**: all words that are due (the FSRS `due` date has passed).
- **New words**: a daily limit you can set (default 10), taken from unseen words starting at your chosen difficulty level on the learning route.
- Order: reviews first, then new words in groups of 5. Each group is first introduced ("first sight": you see all 5 words), then the same 5 words are recalled in shuffled order.

## Question types

| Type | Used for | Description |
| --- | --- | --- |
| Choose meaning | New words, weak memory | See the English word, choose the Turkish meaning. Distractors have the same part of speech |
| Picture cloze | New words, weak memory | Illustration plus a sentence with a blank. Choose the English word; distractors have similar spelling |
| Listen to identify | All stages | Listen only, then choose the word |
| Spelling | Words with stable memory | Spell the word from the picture and definition. Letter-by-letter hints are available (a hinted answer counts at most as Hard) |

## Grading and FSRS

In each round, only the **first answer** to a word updates memory (ts-fsrs, FSRS-6, default target retention 90%):

- Wrong answer: Again
- Correct but slow, or a hint was used: Hard
- Correct: Good. Spelling that is both fast and correct: Easy

A word answered wrongly is practiced again a few questions later in a different question type, up to two retries. Retries are not graded and do not count toward accuracy.

"Mastered" means the word is in the FSRS review state and its memory stability is at least 21 days.

## Typing practice

Typing only trains output and does not change memory state. WPM counts 1 word per 5 correct characters.
