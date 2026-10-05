# Analysis

**Analysis** brings together the tools for looking across your material: searching it, seeing which codes go together, how codes are spread over documents and groups of people, which words people use, and charts of all of these. Every number can be opened: click a cell, a bar or a word to read the passages behind it.

All analysis runs on your computer, on the whole project, and updates when you code more.

<a id="search"></a>

## Text search

Search finds words and phrases across your documents and shows every hit **in context**, aligned on the hit, with the words before and after it (a keyword-in-context view).

- Type what to look for and press `Enter`. Choose **Words**, **Phrase** or **Regex** (a regular expression, for advanced patterns).
- In **Words** mode you can combine words:

| You type | Trama finds |
|---|---|
| `trust family` | paragraphs with both words |
| `trust OR faith` | paragraphs with either word |
| `trust NOT money` | paragraphs with *trust* but without *money* |
| `"health care"` | the exact phrase |
| `garden*` | garden, gardens, gardening… |

- Options: **whole words only**, **match upper and lower case**, **match accents** (by default *médica* also finds *medica*).
- **Search in** all documents, chosen documents, document groups, or only the segments of a code.
- Click a hit to open the document at that place.
- **Code all hits…** applies a code (an existing one or a new one) to every hit: just the words found, the whole sentence (usually best for single words) or the whole paragraph (in transcripts, the speaker’s turn). Passages already coded with that code are left as they are, and one Undo removes everything it added.

<a id="cooccurrence"></a>

## Co-occurrence

![Code co-occurrence](../img/en/analysis-cooccurrence.png)

Which codes appear together, and how often? Choose two or more codes and what **together** means:

- **Overlapping**: the two coded segments share at least one character;
- **In the same paragraph**: in transcripts, the same speaker turn;
- **Near each other**: at most a number of characters apart.

The result is a **matrix** (codes against codes) or a **network** (circles for codes, lines for co-occurrences; drag circles to rearrange). Click a cell or a line to read the pairs of passages.

Two ways of counting:

- **Counts** — the number of *pairs* of segments that occur together. One long segment of A overlapping three segments of B counts 3 (as in MAXQDA). The diagonal shows each code’s own number of segments.
- **Jaccard** — a value from 0 (never together) to 1 (always together) that takes into account how often each code is used, so frequent codes do not dominate:

```
Jaccard(A, B) = (segments of A with B + segments of B with A)
              ÷ (segments of A + segments of B)
```

With **Include sub-codes**, a sub-code’s segments count for its parent.

<a id="matrix"></a>

## Code × document

How is each code spread over your material? Rows are codes; columns are **documents**, **document groups** or **cases**. Each cell shows one of:

- **Segments** — the number of coded segments;
- **Characters** — how much text is coded, overlaps counted once;
- **Presence** — whether the code appears at all;
- **% of document** — the share of the text coded with the code.

With sub-codes included, a parent row adds up its sub-codes. Click a cell to read its segments.

<a id="crosstab"></a>

## Code × attribute

Do older and younger participants talk differently about a theme? Choose an [attribute](06-cases-and-attributes.md#attributes): its values become the columns, codes the rows. Number attributes can be grouped into equal groups (two to five) or shown one column per value.

Count **segments**, **documents** (with the code at least once) or **cases** (with the code in any of their documents), optionally as percentages of the row or of the column. Documents without a case appear under *(no value)*.

**The chi-square test.** When counting documents or cases, Trama tests for each code whether the share of documents (or cases) with the code differs across the attribute’s values more than chance would explain:

```
χ²  = Σ (observed − expected)² ÷ expected
df  = (rows − 1) × (columns − 1)
V   = √( χ² ÷ (n × (min(rows, columns) − 1)) )
```

A small *p* (below 0.05, shown in bold) points to a difference worth a closer look; Cramér’s V says how strong it is, from 0 to 1. Read it as a hint, not a proof: qualitative samples are small and chosen on purpose, not drawn at random, and a test says nothing about *why* a difference exists. When many expected counts are below 5 the test is unreliable, and Trama marks it. No test is shown for segments, because segments are not independent of each other — one talkative person can say the same thing many times.

<a id="words"></a>

## Word frequencies

![Word frequencies](../img/en/analysis-words.png)

Which words do people use most? Count words in all documents, in a document group, or only in the segments of a code.

- **Stop words** — common words such as *the*, *and*, *of* — are left out, using the project’s language (set in Settings) or another you choose: English, Portuguese, Spanish, French, German, Italian or Dutch. Choose **Keep every word** to leave none out.
- Set the **shortest word** counted, and whether numbers count.
- Add your own **words to leave out** — the interviewer’s name, *yeah*, *okay*. They are saved with the project, for everyone working on it. **Leave this word out** on any word adds it.
- See a **cloud** of the most frequent words or a **table** of every word with its count, the number of documents it occurs in and its share. Click a word to read it in context.

**Compare two groups** shows the words one group of documents uses noticeably more than another — or than all other documents. Trama uses the log-likelihood test (G²), which works well with the uneven, small counts of real text, and keeps only words significant at *p* < 0.05. The bar shows how much more each side uses the word, relative to each side’s length.

<a id="charts"></a>

## Charts

- **Code frequencies** — segments and documents per code, sorted; the most used codes or all of them, every code or top-level codes with their sub-codes added in.
- **Document portraits** — each document as a strip from beginning to end, coloured by the code that covers most of each slice; paler means only part of the slice is coded. Click a slice to open the document there. Portraits show at a glance where in interviews a theme comes up.
- **Codes across groups** — stacked bars of up to eight codes in each document group or case, as counts or as shares (100%).

Every chart also has a table view.

<a id="export-results"></a>

## Exporting results

Every tool has **Export**: the table as **CSV** or **Excel**, and charts as **SVG** (sharp at any size, for publications) or **PNG** images. Exported files are not encrypted; see [what leaves this computer](10-privacy-and-security.md#leaves).
