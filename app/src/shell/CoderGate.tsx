import React, { useEffect, useRef, useState } from 'react';
import { UserRound } from 'lucide-react';
import type { Coder } from '../core/model/types';
import { useI18n } from '../ui/i18n';
import { Button } from '../ui/components/Button';
import { RadioGroup } from '../ui/components/Choice';
import { Card, Notice } from '../ui/components/Feedback';
import { TextField } from '../ui/components/Field';
import { useAppState, useProject } from './AppState';
import './shell.css';

const NEW = '__new__';

/**
 * "Who is coding on this computer?" — for a project that came from elsewhere (a teammate's
 * copy) and has no `me` here yet. Every coding is signed by a coder, so nothing opens before.
 */
export function CoderGate({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const project = useProject();
  const { prefs, closeProject } = useAppState();
  const [coders, setCoders] = useState<Coder[] | null>(null);
  const [choice, setChoice] = useState<string>(NEW);
  const [name, setName] = useState(prefs.coderName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    void project.coders().then((list) => {
      setCoders(list);
      const mine = list.find((c) => c.name.trim().toLocaleLowerCase() === prefs.coderName.trim().toLocaleLowerCase());
      if (mine) setChoice(mine.id);
    });
  }, [project, prefs.coderName]);

  async function submit() {
    if (busyRef.current) return;
    if (choice === NEW && !name.trim()) {
      setError(t('app.coder.nameRequired'));
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const id = choice === NEW ? (await project.addCoder(name.trim())).id : choice;
      await project.setMe(id);
      onDone();
    } catch (e) {
      setError(t('common.unknownError', { message: e instanceof Error ? e.message : String(e) }));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <form
        className="gate__inner"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <UserRound size={24} aria-hidden strokeWidth={1.5} className="gate__icon" />
        <h1 className="gate__title">{t('app.coder.title')}</h1>
        <p className="t-secondary">{t('app.coder.body', { project: project.info.name })}</p>
        <Card className="gate__card">
          {coders && coders.length > 0 ? (
            <RadioGroup
              label={t('app.coder.pick')}
              value={choice}
              onChange={setChoice}
              options={[...coders.map((c) => ({ value: c.id, label: c.name })), { value: NEW, label: t('app.coder.someoneNew') }]}
              data-testid="coder-choice"
            />
          ) : null}
          {choice === NEW ? <TextField label={t('app.coder.name')} value={name} onChange={setName} autoFocus maxLength={200} data-testid="coder-name" /> : null}
          {error ? <Notice tone="danger">{error}</Notice> : null}
        </Card>
        <div className="gate__actions">
          <Button variant="ghost" onClick={() => void closeProject()}>
            {t('app.switcher.allProjects')}
          </Button>
          <Button type="submit" variant="primary" busy={busy} data-testid="coder-continue">
            {t('app.coder.continue')}
          </Button>
        </div>
      </form>
    </div>
  );
}
