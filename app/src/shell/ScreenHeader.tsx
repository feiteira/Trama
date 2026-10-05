import React, { type ReactNode } from 'react';
import { Redo2, Undo2 } from 'lucide-react';
import { IconButton } from '../ui/components/Button';
import { useI18n } from '../ui/i18n';
import { useKeyLabel } from './keys';
import { useUndo } from './undo';
import './shell.css';

export interface ScreenHeaderProps {
  title: ReactNode;
  /** A line beside or under the title (a count, the open document). */
  subtitle?: ReactNode;
  /** The screen's own toolbar, right-aligned. */
  actions?: ReactNode;
  /** Something before the title (a back button). */
  leading?: ReactNode;
  /** Undo/Redo at the end of the bar (default true). */
  undo?: boolean;
}

/** The bar at the top of every project screen: title, the screen's actions, Undo and Redo. */
export function ScreenHeader({ title, subtitle, actions, leading, undo = true }: ScreenHeaderProps) {
  return (
    <header className="screen-header">
      {leading}
      <div className="screen-header__titles">
        <h1 className="screen-header__title">{title}</h1>
        {subtitle ? <div className="screen-header__subtitle">{subtitle}</div> : null}
      </div>
      <div className="screen-header__actions">{actions}</div>
      {undo ? <UndoRedo /> : null}
    </header>
  );
}

function UndoRedo() {
  const { t } = useI18n();
  const key = useKeyLabel();
  const { state, undo, redo } = useUndo();
  return (
    <div className="screen-header__undo" role="group" aria-label={t('app.undo.group')}>
      <IconButton
        icon={Undo2}
        label={state.undo ? t('app.undo.undoWhat', { what: state.undo.detail }) : t('common.undo')}
        shortcut={key('Z')}
        disabled={!state.canUndo}
        onClick={() => void undo()}
        data-testid="undo"
      />
      <IconButton
        icon={Redo2}
        label={state.redo ? t('app.undo.redoWhat', { what: state.redo.detail }) : t('common.redo')}
        shortcut={key('Z', { shift: true })}
        disabled={!state.canRedo}
        onClick={() => void redo()}
        data-testid="redo"
      />
    </div>
  );
}

