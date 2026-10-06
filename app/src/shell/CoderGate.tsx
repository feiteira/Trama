import React, { useEffect, useRef, useState } from 'react';
import { UserRound } from 'lucide-react';
import type { Coder } from '../core/model/types';
import { useI18n } from '../ui/i18n';
import { Button } from '../ui/components/Button';
import { RadioGroup } from '../ui/components/Choice';
import { Card, Notice } from '../ui/components/Feedback';
import { TextField } from '../ui/components/Field';
import { inkOn } from '../ui/color';
import { useAppState, useProject } from './AppState';
import { initial } from './initial';
import './shell.css';
import '../features/agreement/gate.css';

const NEW = '__new__';

/**
 * "Who is coding on this computer?" — for a project that came from elsewhere (a teammate's
 * copy) and has no `me` here yet. Every coding is signed by a coder, so nothing opens before.
 */
export function CoderGate({ onDone }: { onDone: () => void }) {
  const { t, tp } = useI18n();
  const project = useProject();
  const { prefs, closeProject } = useAppState();
  const [coders, setCoders] = useState<Coder[] | null>(null);
  const [counts, setCounts] = useState<Map<string | null, number>>(new Map());
  const [choice, setChoice] = useState<string>(NEW);
  // A coder named like me, preselected: maybe me, maybe a teammate with the same first name.
  const [sameName, setSameName] = useState<Coder | null>(null);
  const [name, setName] = useState(prefs.coderName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    void project.store
      .summarise('coding', 'coder_id', 'start')
      .then((rows) => setCounts(new Map(rows.map((r) => [r.key, r.count]))))
      .catch((e: unknown) => console.error(e));
    void project.coders().then((list) => {
      setCoders(list);
      const mine = list.find((c) => c.name.trim().toLocaleLowerCase() === prefs.coderName.trim().toLocaleLowerCase());
      if (mine) {
        setChoice(mine.id);
        setSameName(mine);
      }
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
              options={[
                ...coders.map((c) => {
                  const n = counts.get(c.id) ?? 0;
                  return {
                    value: c.id,
                    label: (
                      <span className="gate-coder">
                        <span className="gate-coder__avatar" style={{ background: c.color, color: inkOn(c.color) }} aria-hidden>
                          {initial(c.name)}
                        </span>
                        <span className="gate-coder__name">{c.name}</span>
                      </span>
                    ),
                    description: n ? tp('agreement.gate.segments', n) : t('agreement.gate.none'),
                  };
                }),
                {
                  value: NEW,
                  label: (
                    <span className="gate-coder">
                      <span className="gate-coder__avatar gate-coder__avatar--new" aria-hidden>
                        +
                      </span>
                      <span className="gate-coder__name">{t('app.coder.someoneNew')}</span>
                    </span>
                  ),
                },
              ]}
              className="gate-coders"
              data-testid="coder-choice"
            />
          ) : null}
          {sameName && choice === sameName.id ? (
            <Notice tone="info" data-testid="coder-same-name">
              {t('agreement.gate.sameName', { name: sameName.name, someoneNew: t('app.coder.someoneNew') })}
            </Notice>
          ) : null}
          {choice === NEW ? <TextField label={t('app.coder.name')} value={name} onChange={setName} autoFocus maxLength={200} data-testid="coder-name" /> : null}
          {error ? <Notice tone="danger">{error}</Notice> : null}
        </Card>
        {coders && coders.length > 0 ? <p className="gate-note">{t('agreement.gate.note')}</p> : null}
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
