import React, { useEffect, useRef } from 'react';
import { UI_LOCALE_META } from './core/i18n/languages';
import { Unlock, Welcome } from './features/onboarding';
import { BrandMark } from './features/onboarding/Frame';
import { ProjectsScreen } from './features/projects';
import type { Platform } from './platform/types';
import type { LibraryOptions } from './services/library';
import { AppStateProvider, type Phase, useAppState } from './shell/AppState';
import { ErrorBoundary } from './shell/ErrorBoundary';
import { ProjectShell } from './shell/ProjectShell';
import { I18nProvider, useI18n } from './ui/i18n';
import { ConfirmProvider } from './ui/components/Confirm';
import { Spinner } from './ui/components/Feedback';
import { ToastProvider, useToast } from './ui/components/Toast';

function Root() {
  const { phase } = useAppState();
  switch (phase.name) {
    case 'loading':
      return <Loading />;
    case 'welcome':
      return <Welcome />;
    case 'locked':
      return <Unlock reason={phase.reason} />;
    case 'library':
      return <ProjectsScreen />;
    case 'project':
      // Keyed on the project: switching projects starts its screens afresh.
      return <ProjectShell key={phase.project.id} initialRoute={phase.initialRoute} />;
  }
}

function Loading() {
  const { t } = useI18n();
  return (
    <div className="app-loading" aria-busy="true">
      <BrandMark size={36} />
      <Spinner size={18} label={t('app.loading')} />
    </div>
  );
}

/** Theme and language on <html>, so CSS tokens and the browser's own text follow them. */
function DocumentPrefs() {
  const { prefs } = useAppState();
  useEffect(() => {
    const html = document.documentElement;
    if (prefs.theme === 'system') delete html.dataset.theme;
    else html.dataset.theme = prefs.theme;
    html.lang = UI_LOCALE_META[prefs.locale].bcp47;
  }, [prefs.theme, prefs.locale]);
  return null;
}

/** What is open: questions and toasts belong to it and go when it changes (a lock). */
function phaseKey(phase: Phase): string {
  return phase.name === 'project' ? `project:${phase.project.id}` : phase.name;
}

function ToastReset({ phase }: { phase: string }) {
  const toast = useToast();
  const first = useRef(true);
  useEffect(() => {
    // A toast's action (Undo) must never run against a project that has since closed.
    if (first.current) first.current = false;
    else if (phase === 'locked' || phase === 'welcome') toast.dismiss();
  }, [phase, toast]);
  return null;
}

function Themed() {
  const { prefs, phase } = useAppState();
  const key = phaseKey(phase);
  return (
    <I18nProvider locale={prefs.locale}>
      <DocumentPrefs />
      <ErrorBoundary>
        <ToastProvider>
          <ToastReset phase={key} />
          <ConfirmProvider key={key}>
            <Root />
          </ConfirmProvider>
        </ToastProvider>
      </ErrorBoundary>
    </I18nProvider>
  );
}

export interface AppProps {
  platform: Platform;
  /** Start in this phase instead of looking at what is on the computer (the demo). */
  initialPhase?: Phase;
  libraryOptions?: LibraryOptions;
}

export function App({ platform, initialPhase, libraryOptions }: AppProps) {
  return (
    <AppStateProvider platform={platform} initialPhase={initialPhase} libraryOptions={libraryOptions}>
      <Themed />
    </AppStateProvider>
  );
}
