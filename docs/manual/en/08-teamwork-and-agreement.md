# Teamwork and inter-coder agreement

Trama has no server and never uses the internet, so a team works the way researchers have long exchanged documents: **each person codes their own copy of the project, and the copies are merged**. Because every coded segment is signed by its coder, Trama can then measure how far two coders agree, and help you talk through where they do not.

<a id="coders"></a>

## Coders

A **coder** is someone who codes in the project — usually a person. **Agreement → Coders & team** lists them with the number of segments each has coded.

- Your coder is chosen on each computer: the name you gave when creating your library or project. Codings, memos and audit-trail entries made on this computer are signed with it.
- When you open a project made on another computer for the first time, Trama asks who is coding: pick your name if you already coded in it, or add yourself.
- **Add coder** adds a teammate; you can rename coders and change their colours.
- **This is me** changes who codes on this computer, for example when the wrong name was picked. Work already done keeps the coder who did it. Who codes on this computer is remembered on this computer only; it is not stored in the project or in the copies you send.

<a id="copies"></a>

## Copies for teammates

1. **Make a copy for a teammate** saves the whole project — documents, codebook, coded segments, memos, cases — as one `.trama` file. Protect it with a **password** when it travels by e-mail or USB stick, and tell your teammate the password another way, by phone for instance. The pseudonymisation key is left out unless you include it.
2. Your teammate chooses **Import a project file** on their projects screen, opens the file (with the password) and says who they are. Their codings are signed with their name.
3. They code their copy — the same documents, or others. They can add codes and memos too.
4. They send their copy back the same way: **Make a copy for a teammate** from their Trama.

To check agreement fairly, agree beforehand on the codebook (with definitions) and on which documents both of you code independently, and do not look at each other’s coding of those documents until you compare.

<a id="merge"></a>

## Merging a teammate’s copy

**Merge a teammate’s copy** and choose the file they sent back. Before anything changes, Trama shows what the copy brings: how many documents, codes, coded segments, memos and cases are **new**, how many are **newer** versions of records you have, and which coders are new.

- New work comes in and nothing of yours is lost.
- Where a record was changed on both sides, the **newer** version is kept.
- Nothing is removed from your project unless your teammate deleted it after your last change to it.
- Only copies of the **same project** can be merged. A different project (or an automatic backup) is recognised and refused with an explanation; import it as a new project instead.

Every merge is recorded in the [audit trail](10-privacy-and-security.md#audit-trail). Merge often: small, frequent merges are easier to understand than one large one at the end.

<a id="compare"></a>

## Comparing two coders

![Inter-coder agreement](../img/en/agreement.png)

**Agreement → Compare coders** measures how two coders, A and B, coded the same material.

1. Choose **Coder A** and **Coder B**.
2. Choose the **documents** — by default, those both coded — and the **codes** — by default, those both used. Codes used by only one coder can be included on request.
3. Choose the **method**: characters, segments or documents (explained below). For segments, set the **overlap needed** for two segments to count as the same.

The results show summary statistics, a table **by code** and **by document**, and the list of **disagreements**.

<a id="disagreements"></a>

### Reviewing disagreements

Disagreements are the useful part: each one is a passage where the codebook can be sharpened. The list shows every segment without a match — coded by only one coder, or with **boundaries** that differ too much. Select one to read the passage with both coders’ codings side by side. Then:

- **Accept A** or **Accept B** — keep one coder’s coding and remove the other’s;
- **Keep both** — leave both and mark the disagreement as reviewed.

**Hide resolved** keeps your place in a long list. Each decision can be undone.

<a id="report"></a>

### Reporting

**Export** saves the results as a **Word** or **web page** report (what was compared, the statistics, a note on how they are calculated, and the disagreements), as **Excel** tables, or as a per-code **CSV** table. Report the coefficient itself — and the method and threshold — not only its label.

<a id="statistics"></a>

## How the statistics are calculated

Trama shows its working: every statistic can be traced to the counts it comes from, and nothing is averaged without saying so. The formulas below are the ones Trama uses.

<a id="character-level"></a>

### Characters (the default)

For each code, every character of every selected document gets two labels: coded or not by A, coded or not by B. The characters are counted into four cells:

| | B coded | B did not code |
|---|---|---|
| **A coded** | both | A only |
| **A did not code** | B only | neither |

The counts of all documents are **added up before** any statistic is computed (a *pooled* estimate). A long interview therefore weighs more than a short note. Averaging one kappa per document, as some programs do, lets a two-line document count as much as an hour-long interview. The pooled figure across all codes adds up the cells of every code in the same way.

**Percent agreement** — the share of characters on which both agree:

```
N                = both + A only + B only + neither
agreement        = (both + neither) ÷ N
agreement, coded = both ÷ (both + A only + B only)
```

Most text is coded by nobody, so the first figure is usually high even when coders agree poorly; the second leaves out the text neither coded and is much more demanding.

**Cohen’s κ (kappa)** — agreement beyond what chance alone would give, where chance comes from how much each coder codes:

```
pₒ = (both + neither) ÷ N
pₑ = a₁ × b₁ + a₀ × b₀
κ  = (pₒ − pₑ) ÷ (1 − pₑ)
```

Here a₁ and b₁ are the shares of the characters that A and B coded, and a₀ = 1 − a₁ and b₀ = 1 − b₁ the shares they did not code.

1 is perfect agreement, 0 is no better than chance, and below 0 is worse than chance.

**Krippendorff’s α (alpha)** — like κ, but chance comes from both coders’ labels pooled together. For two coders and two values (coded / not coded), with *N* characters:

```
d  = A only + B only
n  = 2N
n₁ = 2 × both + d
n₀ = 2 × neither + d
α  = 1 − (n − 1) × d ÷ (n₀ × n₁)
```

With two coders and no missing data, α is very close to κ. Krippendorff advises relying on coding with α ≥ .800 and drawing only tentative conclusions from α ≥ .667.

**When a statistic is undefined.** If there is no variation at all — nobody used the code in these documents, for instance — chance agreement is total and κ and α cannot be computed (they would be 0 ÷ 0). Trama shows a dash rather than pretending the value is 0 or 1.

<a id="segment-level"></a>

### Segments

A segment of A **matches** when B has a segment of the same code in the same document that overlaps it by at least the chosen share of their combined span:

```
overlap   = shared characters
            ÷ (latest end − earliest start)
agreement = matching segments
            ÷ all segments of both coders
```

Every segment of both coders is checked on its own, so one long segment can confirm several short ones. A threshold of 90% demands nearly identical boundaries; lower it if your team agreed to code “roughly the same passage”.

At segment level there is no “neither” cell from which chance could be estimated, so Trama reports **Brennan and Prediger’s κ**, which takes chance agreement as 1/*k*, with *k* the number of codes compared (at least 2):

```
κ = (pₒ − 1/k) ÷ (1 − 1/k)
```

<a id="document-level"></a>

### Documents

For each code and document: did each coder use the code there at least once? The same four cells are counted over code–document pairs, and percent agreement, κ and α are computed as for characters. This is the most forgiving level, useful early on, when the question is whether coders notice the same themes at all.

<a id="interpreting"></a>

### Interpreting the numbers

Trama labels κ with the bands of Landis and Koch (1977): below 0 *poor*, up to .20 *slight*, .21–.40 *fair*, .41–.60 *moderate*, .61–.80 *substantial*, above .80 *almost perfect*. These bands are conventions, not tests. What is good enough depends on your codes, your material and your field. Some points to keep in mind:

- Agreement is a means to a better codebook, not an end. A low value on one code usually means its definition needs work; discuss the disagreements and refine the definition.
- Rare codes give unstable values: one disagreement moves κ a lot.
- Report which statistic, which level, which documents and codes, and which threshold — Trama’s report includes all of them.
