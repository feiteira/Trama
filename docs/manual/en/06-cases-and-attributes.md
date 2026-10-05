# Cases and attributes

A **case** is a unit of analysis: usually a participant, sometimes a household, a school, a site or an organisation. **Attributes** describe cases — age, gender, role, neighbourhood, years of experience — so that you can ask how what people say differs across groups.

![Cases and their attributes](../img/en/cases.png)

<a id="cases"></a>

## Cases

**Cases** shows a table: one row per case, one column per attribute, with the number of documents and coded segments of each case.

- **Add a case** by typing its name in the last row and pressing `Enter`.
- **Edit a value** by clicking a cell (or moving to it with the arrow keys) and typing. `Enter` saves, `Esc` cancels, `F2` edits the cell you are on.
- **Filter** the table by typing part of a case name.
- **Select** cases with the boxes at the start of the rows to delete several at once. Deleting a case keeps its documents (they are left without a case) and deletes its attribute values and the memos about it. You can undo it.
- **Open details** of a case to see and edit its description and colour, its attribute values, the **documents** linked to it (link more, or unlink one), its **coded segments by code**, and memos about it.

<a id="link-documents"></a>

## Linking documents to cases

Each document belongs to at most one case, and a case can have several documents. Link them in either direction:

- from the document list: **Set case…** in a document’s menu;
- from the case’s details: **Link a document…**;
- for many at once: **Create a case for each document** makes a case named after each document without one, and links them (a case that already has that name is reused). This suits one interview per participant.

Survey imports create one case per respondent automatically, with the descriptive columns as attributes (see [Survey answers](02-documents.md#surveys)).

<a id="attributes"></a>

## Attributes

Choose **Attributes** above the table to add, rename, reorder or delete attributes. Each attribute has a name, an optional description (what it records and how) and a **type**:

| Type | Values | Example |
|---|---|---|
| **Text** | Anything | Occupation |
| **Number** | Whole or decimal numbers (`42`, `3,5` or `3.5`) | Age, years gardening |
| **Date** | Dates written as `2026-10-05` | Date of interview |
| **Yes/no** | Yes or no | Has children |
| **Choice** | One of a list of options | Role: Coordinator, Volunteer, Visitor |

- Values that do not fit the type are refused, with a message that says why.
- For a **Choice** attribute, list the options one per line. A new value typed in the table is added to the options automatically.
- Changing an attribute’s type converts the values it can. Trama tells you how many cannot be converted and would be cleared before you confirm — and you can undo it.
- Deleting an attribute deletes its values in every case (undoable too).

Attributes are compared in [Analysis](07-analysis.md): **Code × attribute** tables, filters in [Coded segments](05-retrieval-and-memos.md#filters), and charts by group. Numbers can be grouped into ranges there.

<a id="import-attributes"></a>

## Import attributes from a spreadsheet

Often the attributes already exist in a spreadsheet of participants. Choose **Import attributes from a spreadsheet…** and pick a CSV or Excel file with **one row per case**: a column with the case names and one column per attribute, for example:

| Participant | Age | Role |
|---|---|---|
| Teresa | 71 | Volunteer |
| Rui | 34 | Coordinator |

1. Choose the sheet (in a workbook) and **the column with the case names**. Trama shows how many names match existing cases and how many are new.
2. Choose which columns to import. Each goes into an existing attribute of the same name, or becomes a new attribute; Trama suggests a type from the values.
3. Choose whether to **create the cases that do not exist yet**, or leave those rows out.
4. Import. A summary shows the cases updated and created, the new attributes, the names that matched no case, and any cells that did not fit their attribute’s type (those are skipped).

Names are matched without regard to capitals and accents.

<a id="export-cases"></a>

## Export the cases table

**Export table as CSV** or **as Excel** saves the table as you see it: one row per case, one column per attribute. Cases, attributes and their values are also part of REFI-QDA projects (see [Exchanging projects](09-exchange.md)).
