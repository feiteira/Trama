# The codebook

The codebook is the list of your codes, arranged as a tree, each with a colour and — ideally — a definition. It grows as you read: codes appear, get merged, split and reorganised. **Codebook** in the navigation shows the whole tree on the left and the chosen code’s details on the right.

![The codebook](../img/en/codebook.png)

<a id="hierarchy"></a>

## Codes and the hierarchy

- **New code** adds a code at the top level, or under the chosen code with **New sub-code**. You can also create codes while coding, from the panel next to a selection.
- **Drag** a code onto another to make it a sub-code, or between codes to reorder it. **Move to top level** in its menu takes it out of its parent. A code cannot go inside one of its own sub-codes.
- With the keyboard: the arrow keys move through the tree and open or close branches, typing a few letters jumps to a code, `F2` renames, `Delete` deletes and `Shift+F10` opens the code’s menu.
- **Categories** are codes that only group other codes — “Motivations”, “Barriers”. They cannot be applied to text. Turn a code into a category (or back) with the **Category** switch in its properties.
- Each code has a **colour**, used for its stripes, its tint on the text and in charts. Choose one from the palette or type any colour.

Counts next to each code tell how many coded segments it has. They can include the segments of its sub-codes, show each code alone, or be hidden — choose in the panel’s options.

<a id="definitions"></a>

## Definitions

A good codebook says what each code means, so that you apply it the same way in March as in October, and so that a second coder can apply it as you do. Each code has four fields:

| Field | What to write |
|---|---|
| **Definition** | What the code captures, in a sentence or two. |
| **When to use** | The inclusion criteria: “Apply it when the participant describes…” |
| **When not to use** | The exclusion criteria, often naming the neighbouring code to use instead. |
| **Example** | A typical passage, quoted. |

The definition shows at the foot of the codes panel while you code with the code active, and all four fields are part of every codebook export.

<a id="code-details"></a>

## A code’s details

Choosing a code in **Codebook** shows:

- where it sits in the tree, its properties and its definition;
- how it is used: number of coded segments, of documents and of coders, and the segments per document;
- a preview of its coded segments, with **Show all in Coded segments** to read them all;
- memos about the code, with **New memo about this code**.

<a id="merge-split"></a>

## Merging and splitting codes

As the analysis matures, two codes often turn out to be one, and one code turns out to be two.

**Merge.** Choose **Merge into…** in a code’s menu and pick the code to keep. Its coded segments, sub-codes and memos move to that code, and it is deleted. To merge several codes at once, choose **Merge several codes…** in the code’s details, tick the codes to merge and choose the one to keep. Trama shows how many segments will move before you confirm. Where two merged codes covered the same passage by the same coder, the segments join into one.

**Split.** In a code’s details, tick the coded segments that belong to a new idea and choose **Split into sub-code…**. Name the new sub-code; the chosen segments move to it, the rest stay.

**Delete.** Deleting a code deletes its coded segments and the memos about them; Trama says how many. If the code has sub-codes, choose whether to **keep the sub-codes** (they move up a level, with their segments) or **delete them too**.

All of these can be undone straight away with `Ctrl+Z`, and all of them are recorded in the [audit trail](10-privacy-and-security.md#audit-trail).

<a id="codebook-files"></a>

## Exporting and importing a codebook

**Export** the codebook from the **Codebook** screen as:

- **REFI-QDA codebook** (`.qdc`) — opens in NVivo, MAXQDA, ATLAS.ti and other programs that support REFI-QDA;
- **Word document** (`.docx`) — for an appendix or for a second coder to read;
- **CSV table** or **Excel workbook** (`.xlsx`) — one row per code, with its path, parent, colour, whether it is a category, its shortcut key, the four definition fields, and how many segments and documents it has;
- **Markdown** (`.md`).

**Import** a codebook from a `.qdc`, `.csv` or `.xlsx` file — one made by Trama, by another program, or written by hand in a spreadsheet (a column called **Name** or **Path** is enough; a path such as `Barriers > Time`, or a **Parent** column, creates the hierarchy). Before anything changes, Trama shows which codes are new, which would be updated and which are already the same. Existing codes keep their definitions and colours unless you choose **Replace definitions and colours**; otherwise only their empty fields are filled in. Nothing is deleted by an import.

Code sets (a MAXQDA and NVivo feature) are not imported: Trama has no code sets. Document groups and the hierarchy cover most of their uses.
