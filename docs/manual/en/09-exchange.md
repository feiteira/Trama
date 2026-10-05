# Exchanging projects

Your work should never be locked into one program. Trama reads and writes **REFI-QDA**, the open exchange standard for qualitative analysis software, so you can move a project between Trama and NVivo, MAXQDA, ATLAS.ti, QualCoder, Quirkos or Transana. Its own `.trama` file is a plain ZIP archive in open formats that can be read without Trama.

<a id="refi-qda"></a>

## REFI-QDA in brief

REFI-QDA defines two files:

- a **project** file, `.qdpx` — documents, codes, coded segments, memos, cases, attributes, document groups and coders;
- a **codebook** file, `.qdc` — codes with their hierarchy, colours and definitions (see [Exporting and importing a codebook](04-codebook.md#codebook-files)).

Programs differ in what they can store, so some things are inevitably lost in each direction. Trama always shows a summary of what could not be carried over, so nothing is lost silently.

<a id="import-qdpx"></a>

## Bringing a project in from another program

1. In the other program, export the project to REFI-QDA: look for **REFI-QDA** or **QDPX** in its export or sharing options.
2. In Trama, on the projects screen, choose **Import a project file** and pick the `.qdpx` file. It becomes a new project in your library, encrypted like the others.
3. Read the summary of what was imported and what was not.

Trama works out how each program counted text positions (programs differ in how they count line breaks and special characters), checking against the coded passages themselves, so codings land on the right words.

**From ATLAS.ti**, codes named like `Parent::Child` can be kept as they are or turned into a hierarchy — Trama asks. **From NVivo**, case nodes become cases and annotations become memos on the annotated passage; NVivo does not export code colours, so Trama gives codes colours from its palette. **From MAXQDA**, cases without a name take the name of their first document, attribute values on documents go to the document’s case, and memos on selections become document memos that quote the selected text.

<a id="export-qdpx"></a>

## Taking a project to another program

In **Export & backup**, choose **REFI-QDA project** and save the `.qdpx` file. Then import it in the other program. Options:

- **MAXQDA compatibility** — writes the text files the way MAXQDA expects, so its codings do not shift. Turn it on when the file is going to MAXQDA.
- **Memos** and **recordings** can be left out to make the file smaller.
- **Original PDFs of edited documents** are left out by default (see below); you can include them.

The `.qdpx` file is **not encrypted** and never contains the pseudonymisation key, deleted items or the audit trail.

<a id="carries-over"></a>

## What carries over

| | Into Trama | Out of Trama |
|---|---|---|
| Documents (text) | Yes | Yes |
| Original PDF and Word files | Kept as the original file | PDFs whose text has not been edited |
| Transcripts with time stamps and recordings | Yes | Yes (time stamps need the recording) |
| Codes, hierarchy, colours | Yes | Yes |
| Code definitions | Yes | Yes, with *when to use*, *when not to use* and *example* as labelled parts of the description |
| Coded segments on text, with coders and comments | Yes | Yes |
| Memos on the project, documents, codes and coded segments | Yes | Yes |
| Case memos | Yes | Yes, as a link from the memo to the case |
| Cases, attributes and values | Yes | Yes |
| Document groups | From sets of documents | As sets of documents |
| Coders | Yes | Yes |

<a id="lost"></a>

## What does not carry over

**Coming in**, Trama codes text only, so these are left out and listed in the summary:

- areas coded on PDF pages, pictures and their codings, and codings of time ranges on audio or video (the transcript’s text codings do come in);
- files the `.qdpx` refers to but does not contain (Trama never fetches anything from a disk path or the network);
- sets of codes and of memos, graphs and networks, links that do not attach a memo, and code references on cases;
- attribute values that do not fit their type, and the time part of date-time values;
- codings to codes that do not exist, with impossible positions, or duplicated.

**Going out**, the other program does not get:

- **Choice** attributes as choices: they become text, because REFI-QDA has no list of allowed values;
- colours of cases, groups, memos and documents, code shortcut keys, and the document kinds *survey* and *note* (they become ordinary text documents);
- the audit trail, deleted items and the pseudonymisation key;
- the original PDF of a document whose text you have edited — for instance, pseudonymised. The original would still show what was removed, so the document is written as text unless you explicitly include the originals.

The full mapping, for the technically curious, is in `docs/spec/refi-qda.md` in Trama’s source code.

<a id="trama-file"></a>

## The `.trama` file

A `.trama` file holds one whole project, losslessly: documents and their original files and recordings, the codebook, coded segments, memos, cases and attributes, document groups and the audit trail. Trama uses it for:

- **Export & backup → Trama project file** — to keep a copy, to archive a finished study, or to move to another computer;
- **copies for teammates** ([Teamwork](08-teamwork-and-agreement.md#copies));
- **automatic backups**, which are always encrypted ([Backups](10-privacy-and-security.md#backups)).

When exporting, you can **protect the file with a password** (strongly recommended when it leaves your computer) and choose whether to **include the pseudonymisation key** (left out by default). Exported files carry deleted items only as a note that they were deleted, never their content.

Inside, a `.trama` file without a password is an ordinary ZIP archive: the data as JSON lines, the original files, and a `readable` folder with each document as plain text, the codebook as Markdown and each memo as a Markdown file — so a project stays readable for decades, with or without Trama. A password-protected file is that same archive encrypted.

Import a `.trama` file with **Import a project file** on the projects screen.
