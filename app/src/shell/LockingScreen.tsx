import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Lock } from 'lucide-react';
import { useI18n } from '../ui/i18n';
import { Spinner } from '../ui/components/Feedback';
import { useAppState } from './AppState';

/**
 * Covers the open project while it locks: savers still run underneath (the screens stay
 * mounted), but nothing more can be read or typed. A modal, so it covers open dialogs too.
 */
export function LockingScreen() {
  const { locking } = useAppState();
  if (!locking) return null;
  return createPortal(<Curtain />, document.body);
}

function Curtain() {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  // Take the focus from any field, so keys pressed now cannot reach a page about to be saved.
  useEffect(() => ref.current?.focus(), []);
  return (
    <div ref={ref} className="curtain" role="dialog" aria-modal="true" aria-busy="true" aria-label={t('app.locking')} tabIndex={-1} data-testid="locking">
      <Lock size={22} aria-hidden strokeWidth={1.5} />
      <p className="curtain__title">{t('app.locking')}</p>
      <Spinner size={18} />
    </div>
  );
}
