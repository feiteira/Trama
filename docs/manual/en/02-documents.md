# Documents

Documents are your material: interview and focus-group transcripts, field notes, reports, articles, open answers to a survey. Trama works with their **text**: you code words, sentences and paragraphs. Original files and recordings are kept, encrypted, inside the project.

<a id="import"></a>

## Import documents

![Importing documents](../img/en/import.png)

Open **Import** in the navigation (or **Import documents** in the document list) and choose the files, or drop them onto the screen. Trama reads each file and lists it for review: select one to check its name, what to **Import as** (a document or a transcript), its **Case** and its **Document groups**, any problems found, and a preview of the text. Untick the files you do not want, then import them all at once; one Undo takes the whole import back.

The Import screen also offers **Paste text** (a transcript or notes copied from another program) and **New empty document** (for field notes written straight into Trama); once files are listed, they are in the **…** menu next to **Add files**. A file whose text is already in the project is marked **Already in the project** and left out unless you choose **Import it anyway**.

| Kind of file | Extensions | Notes |
|---|---|---|
| Plain text | `.txt` | Any encoding; files that are not UTF-8 are read as Windows-1252 and flagged so you can check accented letters. |
| Markdown | `.md` | Formatting marks are removed; the text stays. |
| Word | `.docx` | Text, headings and lists. Images and comments are left out (Trama tells you how many). The original file is kept. |
| OpenDocument | `.odt` | As for Word. |
| Rich Text | `.rtf` | Including older Windows code pages. |
| Web page | `.html`, `.htm` | The readable text, without menus and scripts. |
| PDF | `.pdf` | The text layer of each page. The original PDF is kept. Password-protected PDFs ask for the password. |
| Subtitles | `.vtt`, `.srt` | Read as transcripts with time stamps (see below). |
| Spreadsheets | `.csv`, `.xlsx` | Read as survey answers (see below). |

A few things to know:

- **Scanned PDFs** have no text layer, only pictures of pages. Trama tells you which pages have no text. It does not recognise text in images; run the scan through OCR software first, or import a Word or text version.
- **Names** come from the file names. Rename a document at any time (`F2` in the list).
- **Text is canonical**: line endings, invisible characters and Unicode forms are tidied on import, so positions stay exact. Paragraphs are separated by line breaks.
- Very large files are fine. A one-megabyte transcript opens and codes smoothly.

<a id="transcripts"></a>

## Transcripts and recordings

Trama recognises transcripts and keeps **one speaker turn per paragraph**, written as `Speaker: what they said`. That makes it easy to code a whole turn, to compare speakers, and to read a focus group.

- **Subtitle files** (`.vtt`, `.srt`) from Zoom, Teams, Otter or transcription software become transcripts with a time stamp at each turn.
- **Text and Word files** are read as transcripts when they look like one: lines starting with a speaker’s name and a colon, or with time stamps such as `[00:01:23]`. Trama is careful: a field note with lines like `Date: …` stays an ordinary document. If Trama guessed wrong, change **Import as** for that file (**Transcript** or **Document**).
- **Speaker names** that differ only in capitals (`INÊS` and `Inês`) are treated as one speaker. You can rename speakers before importing (“Speaker 1” → “Interviewer”).
- **Auto-code speakers** creates a code for each speaker under a category called “Speakers” and codes every turn with it, so you can later retrieve everything one person said.

**Recordings.** A transcript can carry its audio or video. In the document’s header, choose **Attach a recording…** and pick the file; it is encrypted and stored in the project. A player appears above the text:

- `Ctrl+Space` plays or pauses.
- `Alt+←` and `Alt+→` jump back or forward 5 seconds while the recording plays (or the player has the focus); at other times `Alt+←` is **Back**. `Alt+Shift+←` and `Alt+Shift+→` jump at any time, even when paused.
- `Alt+Enter` plays from the paragraph where the cursor is.
- **Follow the recording in the text** highlights the turn being spoken as it plays.
- Removing a recording erases the file from the project; the transcript and its time stamps stay.

<a id="record"></a>

## Record a call

The desktop app can record an interview held over a video call (Zoom, Teams, Meet, Jitsi or any other) and transcribe it, all on your computer. Nothing is sent anywhere, and no account or connection is needed.

1. Choose **Record a call** (the microphone button at the top of the document list, or `Ctrl+K` and “Record a call”).
2. Give the recording a name, and the names that the transcript should use for you and for the other side.
3. Choose the language spoken, or let Trama detect it.
4. Tick **Everyone on the call has agreed to be recorded**. Research ethics, and the law in many places, require consent; say at the start of the call that you are recording. Recording cannot start without this.
5. Choose **Start recording**.

Trama records two things: your **microphone** and **what your computer plays**, which is everyone else on the call. Both are kept apart, so the transcript knows which words were yours. A strip at the foot of the window shows how long the recording has run and a level for each side; a warning appears if one side is not being recorded. You can go on working in Trama meanwhile, and Trama does not lock itself while it records.

Choose **Stop and save**. The recording becomes a transcript document with its audio, encrypted like every other file of the project. If **Transcribe when the recording stops** was ticked, the transcript is written next (see below).

- **Use headphones.** Without them your microphone also hears the other side through the speakers. Trama leaves out of your side the words that it also heard from the computer, but headphones make the transcript cleaner.
- **Several people on the other side** all appear under the one name you gave the other side. Rename or split their turns afterwards with **Edit the text…**.
- **If Trama or the computer stops** in the middle of a call, the recording is not lost. The next time you open the project, what was recorded up to the last few seconds is saved as a document.
- Recordings are kept as 16 kHz stereo WAV files, about 230 MB per hour.
- **macOS** asks the first time for permission to use the microphone and to record the computer’s sound; Trama needs both. Recording needs macOS 14.2 or later. **Linux** records the computer’s sound through PulseAudio or PipeWire, which almost every desktop uses.

<a id="transcribe"></a>

## Transcribe a recording

Trama comes with a speech model (Whisper large-v3-turbo, through whisper.cpp) that writes out a recording on your computer. It understands Portuguese, Spanish, English and about a hundred other languages.

- **A call recorded in Trama** is transcribed when the recording stops, if you asked for it.
- **A recording you import without a transcript** (an `.mp3`, `.m4a`, `.wav`, `.flac`, `.ogg` or the sound of an `.mp4` or `.mov` video) becomes a transcript document and is transcribed after the import.
- **Any recording without a transcript yet**: open the document and choose **Transcribe on this computer**.

Transcription takes a while: on a recent laptop, roughly half to the whole length of the recording. It runs in the background, one recording at a time; a strip at the foot of the window shows how far it has got, and you can keep working or stop it. If Trama locks or closes first, it carries on the next time the project opens. When it is done, the text arrives in the document, one paragraph per turn with time stamps, so the recording follows along as it plays. The audit trail records which engine wrote the transcript.

Read the transcript against the recording before you code it: automatic transcription mishears names, quiet words and overlapping speech, and may miss a very short reply such as “Yes.” at the start of a turn. A transcript is only written into a document that has no text yet, so it never replaces your own.

<a id="surveys"></a>

## Survey answers

Open answers from a questionnaire usually arrive as a spreadsheet: one row per respondent, one column per question. Import the `.csv` or `.xlsx` file and Trama asks how to read it:

1. The **Sheet** to read, for workbooks with several sheets, and a **Survey name** for the documents.
2. For each column, what to **Use as**: **Respondent id** (without one, the rows are numbered), **Open answer** (the text you want to code), **Attribute** (age, group, site… — they become [case attributes](06-cases-and-attributes.md)) or **Leave out**.
3. **Documents**: **One document per respondent** (each question as a heading with the answer under it; recommended) or **One document per question** (every respondent’s answer under their id).
4. **Create a case for each respondent**, with the attribute columns as attributes (only with one document per respondent). Respondents already in the project are updated.
5. **Code each answer by question** creates a code for each question under a category called “Questions”, so “everything answered to question 3” is one click away later.

<a id="documents"></a>

## The document list

![The document list next to an open document](../img/en/workbench.png)

**Documents** shows the list of documents on the left, the open document in the middle and the codebook on the right. Hide either side panel to give the text more room; drag the edges to resize them.

- **Filter** the list by typing part of a name.
- **Sort** by your own order (drag documents to rearrange), by name, by how much is coded, or by when they were added.
- **Group** the list by document group or by case.
- Select several documents with `Ctrl` or `Shift` and a click, then act on all of them from the menu.
- Each document’s menu (right-click, or `Shift+F10`) can **rename** it, set its **case**, put it in **groups**, give it a **colour**, open its **memo**, show its **properties** (kind, original file, length, number of coded segments, how much of the text is coded) or **delete** it.

Deleting a document also deletes its coded segments and the memos about it. Trama says how many before you confirm, and you can undo it straight away.

<a id="groups"></a>

## Document groups

A document group gathers documents that belong together: the interviews, the first wave, one site, the documents still to code. A document can be in several groups.

- Create a group from **Document groups…** in a document’s menu, or in the groups section of the document list.
- Choose a group to show only its documents. Groups can also be renamed, coloured and deleted; deleting a group never deletes its documents.
- Groups are used throughout the analysis: to filter coded segments, to compare word use, as the columns of a code × document matrix, and in charts.

<a id="cases-link"></a>

## Documents and cases

A **case** is a unit of analysis — usually a participant, sometimes a site, a household or an organisation. Each document can belong to one case; a case can have several documents (two interviews with the same person, say). Set a document’s case from its menu (**Set case…**): type to find a case, or type a new name to create one.

Cases carry **attributes** such as age, role or neighbourhood, which let you compare groups of people. They have [a chapter of their own](06-cases-and-attributes.md).
