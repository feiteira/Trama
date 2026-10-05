# Security

Trama holds qualitative research data — interview transcripts, recordings, participants' details — that is often sensitive personal data. We take reports seriously and are grateful for them.

## Reporting a vulnerability

Please report privately — **do not open a public issue**. Use GitHub's private reporting: the **Report a vulnerability** button under this repository's **Security** tab. Include what you found, how to reproduce it, and the Trama version and operating system.

We aim to acknowledge reports within 5 working days, to keep you informed while we work on a fix, and to agree a disclosure date with you once a fix is ready. We are happy to credit you, or not, as you prefer.

**Never include real research data** in a report, a screenshot or an attached file — no transcripts, recordings or participant details, even pseudonymised. Use the example project or invented material.

You may write in English, Portuguese or Spanish.

## Supported versions

Only the latest release receives security fixes.

## What Trama protects against

See [`docs/security/threat-model.md`](docs/security/threat-model.md). In short: every project on disk is encrypted (SQLCipher, with a per-project key derived from a library key that only your passphrase or 12-word recovery phrase can unlock, through Argon2id); original files, recordings and backups are encrypted with XChaCha20-Poly1305; the list of projects is encrypted too; Trama locks itself and wipes its keys after a period without use; and Trama makes no network connections at all.

## Especially welcome

- Ways to read project content, project names or the pseudonymisation key without the passphrase or recovery phrase.
- Any network request Trama makes, or any way to make it make one.
- Crafted files (DOCX, PDF, RTF, `.qdpx`, `.trama`) that cause code execution, write outside their folder, or corrupt other projects.
- Exports or backups that contain something they should not (the pseudonymisation key, deleted content, an original that was pseudonymised).
