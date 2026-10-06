import React, { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, Copy, KeyRound, Lock, ShieldCheck, Trash2 } from 'lucide-react';
import { UI_LOCALE_META, UI_LOCALES, type UiLocale } from '../../core/i18n/languages';
import { FLOWS, NO_NETWORK, PRIVACY_HEAD } from '../../core/privacy/flows';
import { LIMITS, SETTING_KEYS } from '../../core/model/types';
import { STOPWORD_LANGUAGES } from '../../core/qda/stopwords';
import { AUTO_LOCK_MINUTES, type AutoLockMinutes, type ThemePref } from '../../services/prefs';
import { useAppState, useLibrary, useProject } from '../../shell/AppState';
import { useLive } from '../../shell/useLive';
import type { ScreenProps } from '../../shell/router';
import { ScreenHeader } from '../../shell/ScreenHeader';
import { useCommands } from '../../shell/useCommands';
import { cx } from '../../ui/cx';
import { useI18n } from '../../ui/i18n';
import { Button, IconButton } from '../../ui/components/Button';
import { RadioGroup } from '../../ui/components/Choice';
import { useConfirm } from '../../ui/components/Confirm';
import { Badge } from '../../ui/components/Feedback';
import { Select, TextField } from '../../ui/components/Field';
import { useToast } from '../../ui/components/Toast';
import { BUNDLED } from './licences';
import { ChangePassphraseDialog, NewRecoveryDialog } from './SecurityDialogs';
import '../onboarding/onboarding.css';
import { forgetAllProjectPrefs } from '../common/localPrefs';
import './settings.css';

/** Trama's own settings on this computer (not the project's). */
export default function SettingsScreen(_props: ScreenProps<'settings'>) {
  const { t } = useI18n();
  const [dialog, setDialog] = useState<'passphrase' | 'recovery' | null>(null);
  const inProject = useAppState().phase.name === 'project';

  useCommands(
    () => [
      { id: 'settings.passphrase', label: t('settings.commands.changePassphrase'), group: t('settings.commands.group'), icon: Lock, run: () => setDialog('passphrase') },
      { id: 'settings.recovery', label: t('settings.commands.newRecovery'), group: t('settings.commands.group'), icon: KeyRound, run: () => setDialog('recovery') },
    ],
    [t],
  );

  return (
    <>
      <ScreenHeader title={t('settings.title')} subtitle={t('settings.subtitle')} undo={false} />
      <div className="set" data-testid="screen-settings">
        <div className="set__column">
          <General />
          {inProject ? <ProjectGroup /> : null}
          <Security onDialog={setDialog} />
          <Privacy />
          <About />
        </div>
      </div>
      <ChangePassphraseDialog open={dialog === 'passphrase'} onClose={() => setDialog(null)} />
      <NewRecoveryDialog open={dialog === 'recovery'} onClose={() => setDialog(null)} />
    </>
  );
}

function Group({ id, title, children, description }: { id: string; title: string; children: ReactNode; description?: ReactNode }) {
  return (
    <section className="set__group" aria-labelledby={`${id}-title`} data-testid={`settings-${id}`}>
      <h2 className="set__group-title" id={`${id}-title`}>
        {title}
      </h2>
      {description}
      <div className="set__card">{children}</div>
    </section>
  );
}

function Row({ label, hint, children, labelId, danger }: { label: ReactNode; hint?: ReactNode; children?: ReactNode; labelId?: string; danger?: boolean }) {
  return (
    <div className={cx('set__row', danger && 'set__row--danger')}>
      <div className="set__row-text">
        <div className="set__label" id={labelId}>
          {label}
        </div>
        {hint ? <div className="set__hint">{hint}</div> : null}
      </div>
      {children ? <div className="set__control">{children}</div> : null}
    </div>
  );
}

/** Settings of the open project, saved in it (for everyone working on it). */
function ProjectGroup() {
  const { t } = useI18n();
  const project = useProject();
  const toast = useToast();
  const { data } = useLive(async (store) => (await store.get('setting', SETTING_KEYS.textLanguage)) ?? null, [], ['setting']);
  const stored = data && !data.deleted && typeof data.value === 'string' ? data.value : '';
  const value = (STOPWORD_LANGUAGES as readonly string[]).includes(stored) ? stored : '';
  const save = async (lang: string) => {
    try {
      if (lang) await project.store.put('setting', { id: SETTING_KEYS.textLanguage, value: lang });
      else if (data && !data.deleted) await project.store.remove('setting', [SETTING_KEYS.textLanguage]);
      toast.show({ message: t('settings.materialLanguage.saved'), tone: 'success' });
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Group id="project" title={t('settings.sections.project')}>
      <Row label={t('settings.materialLanguage.label')} hint={t('settings.materialLanguage.hint')} labelId="set-material-language">
        <Select<string>
          value={value}
          onChange={(v) => void save(v)}
          aria-labelledby="set-material-language"
          size="sm"
          options={[{ value: '', label: t('settings.materialLanguage.unset') }, ...STOPWORD_LANGUAGES.map((l) => ({ value: l, label: t(`analysis.words.languages.${l}`) }))]}
          data-testid="settings-material-language"
        />
      </Row>
    </Group>
  );
}

function General() {
  const { t, tp } = useI18n();
  const { prefs, setPrefs } = useAppState();
  const toast = useToast();
  const [name, setName] = useState(prefs.coderName);
  useEffect(() => setName(prefs.coderName), [prefs.coderName]);
  const nameDirty = name.trim() !== prefs.coderName.trim();

  const saveName = async () => {
    if (!nameDirty) return;
    await setPrefs({ coderName: name.trim() });
    toast.show({ message: t('settings.name.saved'), tone: 'success' });
  };

  return (
    <Group id="general" title={t('settings.sections.general')}>
      <Row label={t('settings.language.label')} hint={t('settings.language.hint')} labelId="set-language">
        <RadioGroup<UiLocale>
          label={t('settings.language.label')}
          hideLabel
          variant="segmented"
          value={prefs.locale}
          onChange={(locale) => void setPrefs({ locale })}
          options={UI_LOCALES.map((l) => ({ value: l, label: <span lang={UI_LOCALE_META[l].bcp47}>{UI_LOCALE_META[l].nativeName.replace(/ \(.*\)$/, '')}</span> }))}
          className="set__segmented"
          data-testid="settings-language"
        />
      </Row>
      <Row label={t('settings.theme.label')} hint={t('settings.theme.hint')}>
        <RadioGroup<ThemePref>
          label={t('settings.theme.label')}
          hideLabel
          variant="segmented"
          value={prefs.theme}
          onChange={(theme) => void setPrefs({ theme })}
          options={[
            { value: 'system', label: t('settings.theme.system') },
            { value: 'light', label: t('settings.theme.light') },
            { value: 'dark', label: t('settings.theme.dark') },
          ]}
          className="set__segmented"
          data-testid="settings-theme"
        />
      </Row>
      <Row label={t('settings.autoLock.label')} hint={t('settings.autoLock.hint')} labelId="set-autolock">
        <Select<string>
          aria-labelledby="set-autolock"
          value={String(prefs.autoLockMinutes)}
          onChange={(v) => void setPrefs({ autoLockMinutes: Number(v) as AutoLockMinutes })}
          options={AUTO_LOCK_MINUTES.map((n) => ({ value: String(n), label: tp('settings.autoLock.minutes', n) }))}
          data-testid="settings-auto-lock"
        />
      </Row>
      <Row label={t('settings.name.label')} hint={t('settings.name.hint')} labelId="set-name">
        <form
          className="set__name"
          onSubmit={(e) => {
            e.preventDefault();
            void saveName();
          }}
        >
          <TextField aria-labelledby="set-name" value={name} onChange={setName} placeholder={t('settings.name.placeholder')} maxLength={LIMITS.nameMax} data-testid="settings-name" />
          <Button type="submit" variant="secondary" disabled={!nameDirty || !name.trim()} data-testid="settings-name-save">
            {t('settings.name.save')}
          </Button>
        </form>
      </Row>
    </Group>
  );
}

function Security({ onDialog }: { onDialog: (d: 'passphrase' | 'recovery') => void }) {
  const { t } = useI18n();
  const library = useLibrary();
  const { platform, example, setPrefs, erased } = useAppState();
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function eraseAll() {
    const word = t('settings.erase.word');
    const ok = await confirm({
      title: t('settings.erase.title'),
      body: t('settings.erase.body'),
      confirmLabel: t('settings.erase.confirm'),
      danger: true,
      typeToConfirm: word,
      typePrompt: t('settings.erase.prompt', { word }),
      'data-testid': 'erase-dialog',
    });
    if (!ok) return;
    setBusy(true);
    try {
      // The keys go first, so nothing can write to a project while its files are removed.
      await library.lock();
      await platform.eraseAll();
      forgetAllProjectPrefs();
      await setPrefs({ lastProjectId: null });
      erased();
    } catch (e) {
      setBusy(false);
      toast.error(e);
    }
  }

  return (
    <Group id="security" title={t('settings.sections.security')}>
      <Row label={t('settings.passphrase.label')} hint={t('settings.passphrase.hint')}>
        <Button variant="secondary" icon={Lock} onClick={() => onDialog('passphrase')} data-testid="settings-change-passphrase">
          {t('settings.passphrase.change')}
        </Button>
      </Row>
      <Row label={t('settings.recovery.label')} hint={t('settings.recovery.hint')}>
        <Button variant="secondary" icon={KeyRound} onClick={() => onDialog('recovery')} data-testid="settings-new-recovery">
          {t('settings.recovery.button')}
        </Button>
      </Row>
      <Row label={t('settings.erase.label')} hint={example ? t('settings.erase.exampleNote') : t('settings.erase.hint')} danger>
        <Button variant="danger" icon={Trash2} onClick={() => void eraseAll()} busy={busy} disabled={example} data-testid="settings-erase">
          {t('settings.erase.button')}
        </Button>
      </Row>
    </Group>
  );
}

function Privacy() {
  const { t, locale } = useI18n();
  const head = PRIVACY_HEAD[locale];
  return (
    <Group
      id="privacy"
      title={head.title}
      description={
        <div className="set__privacy-lead">
          <ShieldCheck size={18} aria-hidden strokeWidth={1.75} />
          <div>
            <p className="set__privacy-strong">{t('settings.privacy.lead')}</p>
            <p>{NO_NETWORK[locale]}</p>
          </div>
        </div>
      }
    >
      <ul className="flows" data-testid="privacy-flows">
        {FLOWS.map((f) => {
          const text = f.text[locale];
          return (
            <li key={f.id} className="flows__item">
              <details className="flows__details" data-testid={`flow-${f.id}`}>
                <summary className="flows__summary">
                  <ChevronDown size={15} aria-hidden className="flows__chevron" />
                  <span className="flows__title">{text.title}</span>
                  <span className="flows__badges">
                    <Badge tone={f.trigger === 'setting' ? 'info' : 'neutral'}>{t(`settings.privacy.trigger.${f.trigger}`)}</Badge>
                    <Badge tone={f.encrypted === 'always' ? 'success' : f.encrypted === 'optional' ? 'neutral' : 'warning'}>{t(`settings.privacy.encrypted.${f.encrypted}`)}</Badge>
                  </span>
                </summary>
                <dl className="flows__body">
                  <div>
                    <dt>{head.when}</dt>
                    <dd>{text.when}</dd>
                  </div>
                  <div>
                    <dt>{head.what}</dt>
                    <dd>{text.what}</dd>
                  </div>
                  <div>
                    <dt>{head.who}</dt>
                    <dd>{text.who}</dd>
                  </div>
                </dl>
              </details>
            </li>
          );
        })}
      </ul>
    </Group>
  );
}

function About() {
  const { t } = useI18n();
  const { platform } = useAppState();
  const toast = useToast();
  const [info, setInfo] = useState<{ version: string; data_dir: string } | null>(null);
  const [showLicences, setShowLicences] = useState(false);

  useEffect(() => {
    let live = true;
    platform
      .info()
      .then((i) => live && setInfo({ version: i.version, data_dir: i.data_dir }))
      .catch((e: unknown) => console.error(e));
    return () => {
      live = false;
    };
  }, [platform]);

  const copyPath = () => {
    if (!info) return;
    void navigator.clipboard?.writeText(info.data_dir).then(
      () => toast.show(t('settings.about.copied')),
      () => undefined,
    );
  };

  return (
    <Group id="about" title={t('settings.sections.about')}>
      <Row label={t('settings.about.version')}>
        <span className="set__value" translate="no" data-testid="settings-version">
          Trama {info?.version ?? ''}
        </span>
      </Row>
      <Row label={t('settings.about.licence')} hint={t('settings.about.licenceHint')}>
        <span className="set__value" translate="no">
          {t('settings.about.licenceValue')} <span className="set__muted">(MPL-2.0)</span>
        </span>
      </Row>
      <Row label={t('settings.about.dataFolder')} hint={t('settings.about.dataFolderHint')}>
        <span className="set__path">
          <code className="set__code" title={info?.data_dir} data-testid="settings-data-dir">
            <span dir="ltr">{info?.data_dir ?? '…'}</span>
          </code>
          <IconButton icon={Copy} label={t('settings.about.copyPath')} size="sm" onClick={copyPath} disabled={!info} data-testid="settings-copy-path" />
        </span>
      </Row>
      <Row label={t('settings.about.licences')} hint={t('settings.about.licencesHint')}>
        <Button variant="ghost" size="sm" iconEnd={ChevronDown} onClick={() => setShowLicences((s) => !s)} aria-expanded={showLicences} aria-controls="set-licences" className={cx('set__disclose', showLicences && 'set__disclose--open')} data-testid="settings-licences-toggle">
          {showLicences ? t('settings.about.hideLicences') : t('settings.about.showLicences')}
        </Button>
      </Row>
      {showLicences ? (
        <div className="licences" id="set-licences" data-testid="settings-licences">
          {(['fonts', 'libraries', 'desktop'] as const).map((k) => (
            <div key={k} className="licences__group">
              <h3 className="licences__title">{t(`settings.about.${k}`)}</h3>
              <ul className="licences__list">
                {BUNDLED[k].map((s) => (
                  <li key={s.name}>
                    <span translate="no">{s.name}</span>
                    <span className="licences__licence" translate="no">
                      {s.licence}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </Group>
  );
}
