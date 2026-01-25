Steward uses a lexical search engine with BM25 scoring to find and rank documents in your vault.

## Lexical search

Lexical search matches documents based on the actual terms in your query. Unlike semantic search, it doesn't understand meaning—it finds documents that contain the words you type.

## Tokenization

Tokenization breaks text into searchable terms during indexing and searching.

### Content tokenization

When indexing note content:

1. Remove HTML comments and special patterns
2. Convert to lowercase
3. Remove special characters and diacritics
4. Apply stemming (e.g., "running" → "run")

### Name tokenization

When indexing filenames:

1. Convert to lowercase
2. Remove special characters and diacritics
3. Split on word delimiters (e.g., "MeetingNotes" → "meeting", "notes")
4. Apply stemming

### Example

Query: `"project planning notes"`

Tokenized: `["project", "plan", "note"]`

## BM25 scoring

BM25 (Best matching 25) ranks documents by relevance. It considers:

- **Term frequency**: How often a term appears in a document
- **Document length**: Longer documents don't dominate short ones
- **Inverse document frequency**: Rare terms across the vault score higher

### Formula

For each term:

```
Score = IDF × (tf × (k1 + 1)) / (tf + k1 × (1 - b + b × docLen / avgDocLen))
```

Where:

- `k1` controls term frequency saturation (default: 1.5)
- `b` controls length normalization (default: 0.75)

## Bonus scoring

After BM25 calculates base scores, bonuses adjust the final ranking.

### Coverage Bonus

Documents matching more query terms rank higher.

| Query terms | Matched terms | Coverage bonus |
| ----------- | ------------- | -------------- |
| 3           | 3             | High           |
| 3           | 2             | Medium         |
| 3           | 1             | Low            |

### Proximity bonus

Terms appearing close together in a document score higher.

Example query: `"meeting agenda"`

| Document content                           | Proximity bonus |
| ------------------------------------------ | --------------- |
| "...the meeting agenda for..."             | High            |
| "...meeting next week. The agenda..."      | Medium          |
| "...meeting... [50 words later] agenda..." | None            |

### Filename bonus

Documents with query terms in the filename get boosted.

Query: `"budget report"`

| Document                              | Filename bonus |
| ------------------------------------- | -------------- |
| `Budget Report 2024.md`               | High           |
| `Notes.md` (contains "budget report") | None           |

## Scoring parameters

Configure these in Settings → Search:

| Parameter            | Default | Description                          |
| -------------------- | ------- | ------------------------------------ |
| BM25 k1              | 1.5     | Term frequency saturation (0.5-3)    |
| BM25 b               | 0.75    | Length normalization (0-1)           |
| Max coverage bonus   | 0.5     | Bonus for matching more terms        |
| Filename match boost | 2.0     | Multiplier for filename term matches |
| Filename bonus       | 0.5     | Flat bonus for any filename match    |
| Max proximity bonus  | 5.0     | Bonus for terms appearing close      |
| Proximity threshold  | 20      | Max token distance for proximity     |
