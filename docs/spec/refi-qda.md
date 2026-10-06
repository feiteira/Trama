# REFI-QDA in Trama

Trama reads and writes the open [REFI-QDA](https://www.qdasoftware.org/) exchange formats, version 1.0 of the schemas (spec 1.5):

- **`.qdpx`**: a whole project. It is a ZIP file holding `project.qde` (XML, namespace `urn:QDA-XML:project:1.0`) and a `sources/` folder.
- **`.qdc`**: a codebook. It is one XML file, namespace `urn:QDA-XML:codebook:1.0`.

NVivo, MAXQDA, ATLAS.ti, QualCoder, Quirkos and Transana exchange projects through these formats. This page describes how Trama's data maps to REFI-QDA, and what is lost in each direction. Trama always shows the researcher a summary of what could not be carried over.

The code is in `app/src/core/export/refi/`. It has these entry points:

- `importQdpx(bytes, {defaultCoderName, splitColonNames?})` returns a `ProjectBundle`.
- `exportQdpx(bundle, {origin, crlfForMaxqda?, includeMemos?, includeMedia?, includeEditedOriginals?})` returns `{bytes, warnings}`.
- `importQdc(xml)` returns `{codes, origin, warnings}`.
- `exportQdc(codes, {origin})` returns the XML.

## Text positions

Trama stores UTF-16 offsets into canonical text: LF line endings, no byte-order mark, Unicode NFC. REFI-QDA counts Unicode code points into the text file as written, using half-open ranges `[start, end)`. Producers deviate from this, so the importer decides **for each text** how its positions were counted:

| Question | Candidates | How it is decided |
|---|---|---|
| Byte-order mark | — | Removed and never counted. QualCoder writes one. |
| CRLF line endings | CRLF counts as 2 (the spec, NVivo) or as 1 (ATLAS.ti, MAXQDA-bound files, Trama with the MAXQDA option) | Checked against the selections, see below. With no evidence, the project-wide majority decides. If there is no evidence at all, the origin decides: ATLAS.ti or Trama means 1, anything else means 2. |
| Unit | Code points (the spec) or UTF-16 code units | Checked against the selections; code points without evidence. This only matters for texts with characters outside the BMP, such as emoji. |
| Normalisation | — | The text is converted to NFC, and positions are mapped through the change. A position inside a composed character widens the span; it never shrinks it. |

**The check.** ATLAS.ti, MAXQDA and Trama put the start of the selected text in `PlainTextSelection@name`. Up to 64 selections spread across the document are tried under each candidate counting. The counting under which the most selected texts start with their name wins. Whitespace runs compare as one space and a trailing "…" is ignored.

Trama exports code-point offsets into the LF text. The **MAXQDA line endings** option (`crlfForMaxqda`, the only switch on the export card) writes the text files with CRLF but leaves the positions unchanged, because MAXQDA shifts codings in LF files.

## Container

| | Import | Export |
|---|---|---|
| Project file | `project.qde`, or else any `*.qde`, at the shallowest level of the ZIP (a project zipped inside a folder works) | `project.qde`, UTF-8, no BOM |
| Sources folder | `sources/` or `Sources/`. Lookup ignores case, and falls back to a file of the same name anywhere in the ZIP | lower-case `sources/<guid>.<ext>` |
| Paths | `internal://…` is read. `relative://` and `absolute://` files cannot be reached and are reported | `internal://` only |
| Unsafe ZIP entries (`..`, absolute paths) | Ignored and reported (zip-slip) | — |
| Namespaces | Matched by element name only, so the 1.0, pre-1.0 (`urn:QDA-XML:project:0:10`) and prefixed forms all work | `urn:QDA-XML:project:1.0` with `xsi:schemaLocation` |
| GUIDs | Compared lower-cased, with braces removed | Record ids (UUID v4), lower case |
| Files over 2 GB | — | Left out, with a warning (REFI-QDA limit) |

## Project mapping

| REFI-QDA | Trama (import) | Trama (export) |
|---|---|---|
| `Project@name`, `Description`, `@origin` | Project name, description, origin | Same; `origin` is "Trama <version>" |
| `User` | Coder | Every live coder |
| `Code` (nested) | Code with `parent_id`. `isCodable="false"` makes it a folder (not codable); a missing `isCodable` counts as true | Code tree in sibling order |
| `Code@color` | Colour (`#RGB` is expanded). When missing (NVivo exports none), one is taken from the palette | `#RRGGBB` |
| `Code/Description` | Definition. In files whose origin is Trama, the labelled sections "Inclusion criteria:", "Exclusion criteria:" and "Example:" go back into their own fields: only the block at the end, each label alone on its line after a blank line, in that order. Anything else (such as "Example: …" inside the definition) stays in the definition | Definition, followed by those labelled sections, each label alone on its line after a blank line. A line of the researcher's own that reads exactly like a label gets a zero-width space in front, so it is never taken for one |
| `Variable` | Attribute: Text→text, Boolean→boolean, Integer/Float→number, Date/DateTime→date | text→Text, number→Integer (all whole numbers) or Float, date→Date, boolean→Boolean, choice→Text |
| `Case` + `VariableValue` | Case + values. A nameless case (MAXQDA, Quirkos) takes the name of its first source | Case + values |
| `Case/SourceRef` | `document.case_id`. When a document is in several cases, the first wins | One `SourceRef` per document of the case |
| `Case/SelectionRef` | The selection's whole document joins the case | — |
| `VariableValue` on a source (MAXQDA) | Goes to the document's case. A case named after the document is created when it has none | — |
| `TextSource` | Text document (`plainTextPath` or `PlainTextContent`; a `.docx` in `richTextPath` is kept as the original file) | `TextSource` with `plainTextPath`, and `richTextPath` holding the original Word file when its text is unchanged since import (see Losses) |
| `PDFSource` + `Representation` | PDF document: the representation's text, with the PDF kept as the original file | `PDFSource` with the PDF and a `Representation` holding the codings, but only when the text is unchanged since import (see Losses) |
| `AudioSource`/`VideoSource` + `Transcript` | Transcript document: transcript text, `SyncPoint` time stamps and the media file. A `Transcript/Description` becomes a document memo titled "Description" | `TextSource` (with the codings) plus `AudioSource`/`VideoSource` (with the media file and a `Transcript` with `SyncPoint`s) pointing to the same text file. On import, Trama joins them back into one document |
| Media without a transcript | Empty transcript with the media, ready to transcribe | — |
| `PlainTextSelection` + `Coding` | One coding per `Coding`. The coder is taken from `Coding@creatingUser`, else the selection's `creatingUser`, else `Project@creatingUserGUID`, else a coder named after the researcher. A user GUID that `Users` does not list still gets a coder of its own, named "User" and the GUID's first 8 characters (reported, so it can be renamed) | One selection per (span, coder, comment), with one `Coding` per code. `name` holds the start of the text |
| `TranscriptSelection` | Codings from `fromSyncPoint.position` to `toSyncPoint.position` | — |
| `Coding` directly on a source | A coding over the whole text | — |
| Selection `Description` with codings | The comment on each coding. Over 4,000 characters, it is shortened and the full text goes into a coding memo | Coding comment |
| Selection `Description` without codings (MAXQDA) | Document memo that quotes the selected text | — |
| Source `Description` | Document memo titled "Description" | — |
| `Note` | Memo, attached where its `NoteRef`s are: Project→project memo, Code→code memo, Source/Transcript→document memo, Coding→coding memo, Selection→memo on its first coding. Notes that nothing references become project memos | Memo as a `Note` with `PlainTextContent`, plus a `NoteRef` in its target |
| `Link` from a Note | NVivo annotation (Note → selection): a memo on the selection's coding, or a document memo that quotes the text. Note → Case: case memo | Case memo: a `Link` from the Note to the Case, because cases cannot hold a `NoteRef` |
| `Set` with `MemberSource` | Document group. Its `Description` becomes a project memo titled with the group's name | Document group as a `Set` with `MemberSource` |
| NVivo case nodes (a `Code` with the GUID of a `Case`) | The pseudo-code is dropped; its codings assign their document to the case | — |
| ATLAS.ti "Parent::Child" names | Unchanged, or split into a hierarchy when the researcher asks (`splitColonNames`) | — |

## Losses

**Import (reported in the summary):**

- PDF area selections, pictures and picture selections, and audio/video time-range codings: Trama codes text only.
- Media and text files stored outside the `.qdpx` (relative or absolute paths). Trama cannot reach them, and making a network or disk request would break its privacy promise.
- Sets of codes and of notes. Links that do not attach a memo. Graphs. Code references on cases.
- Attribute values that do not fit their type. The time part of date-time values.
- Codings to missing codes, with impossible positions, or duplicated (same code, coder and span). Spans that run past the end of a text are shortened.
- Codes marked as folders but holding codings are made codable, so the codings stay visible.
- Text files that are not valid UTF-8: a stray invalid byte becomes U+FFFD (one character, so the positions after it still match); a file that is mostly not UTF-8 is read as Windows-1252. Either way the summary says so.
- Exactly one byte-order mark is removed from a text file. A further U+FEFF (QualCoder keeps the BOM of a file it imported as text) counts as a position but is left out of the text.

**Export (reported after export):**

- Deleted records and the pseudonymisation key are never written.
- Choice attributes become Text, because REFI-QDA has no list of allowed values. Colours of cases, groups, memos and documents, code shortcuts, document kinds "survey" and "note", and the audit trail are not part of REFI-QDA.
- **Original PDFs and Word files of edited documents are left out.** An edit can be pseudonymisation or a typo fix; Trama detects it because the text no longer matches the hash taken at import. The original would still show what was removed. These documents are written as text. The export screen always does this; `includeEditedOriginals` exists in `exportQdpx` but is not offered to the researcher, and neither are `includeMemos`/`includeMedia` (memos and recordings are always written).
- Transcripts without their recording lose their time stamps.
- Memos whose item was deleted are attached to the project.

## Validation

The exported `project.qde` and `.qdc` are checked against the official XSDs in the tests: `app/src/core/export/refi/fixtures/`, using Python lxml when it is available. Other tests cover round trips (export then import gives the same texts, code tree, codings, coders, cases, attributes, memos, groups, sync points and files) and vendor-style files: ATLAS.ti CRLF=1 with upper-case GUIDs, NVivo CRLF=2 with case nodes and annotations, MAXQDA nameless cases and segment memos, QualCoder BOM and annotations, and pre-1.0 namespaces.
