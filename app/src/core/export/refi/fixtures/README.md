# REFI-QDA test fixtures

- `Project.xsd`, `Codebook.xsd`: the official REFI-QDA 1.0 schemas (QDA-XML, release 18 March 2019),
  copied unchanged from the openqda/refi-tools mirror of qdasoftware.org. The REFI standard
  documents are MIT licensed; copyright QDAsoftware.org.
- `example-project.qde`, `example-codebook.qdc`: small hand-written files that use most elements
  and validate against the schemas. All names and texts are fictional.

The XSD validation tests run `validate-xsd.py` with a Python that has `lxml`. They are skipped
when none is found; set `REFI_XSD_PYTHON=/path/to/python` to choose one. The office writer tests
likewise reopen their files with openpyxl and python-docx when `OFFICE_PYTHON` (or that Python)
has them, and convert a .docx with LibreOffice when `soffice` is installed.
