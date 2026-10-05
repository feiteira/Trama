<!-- Never include real research data — transcripts, recordings, participant details — in code, fixtures, screenshots or this description, not even pseudonymised. -->

**What changes and why**

**How it was checked**

**Checks**
- [ ] `npm run typecheck` and `npm test` pass (and `npm run lint:rust` / `npm run test:rust` for Rust changes)
- [ ] Visible text added or changed in all three languages (en, pt-PT, es-ES)
- [ ] Manual updated in all three languages (`docs/manual/{en,pt,es}`), if how something is done changed
- [ ] Works from the keyboard, in light and dark themes, at 1000 × 660
- [ ] No new network access; any new way data leaves the computer is in `app/src/core/privacy/flows.ts` and `PRIVACY.md` is regenerated
- [ ] Schema changes are new migrations, not edits to shipped ones
- [ ] Commits are signed off (`git commit -s`)
