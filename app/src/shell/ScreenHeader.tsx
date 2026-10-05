import React, { useEffect, type ReactNode } from 'react';
import { CircleHelp, Redo2, Undo2 } from 'lucide-react';
import { IconButton } from '../ui/components/Button';
import { useI18n } from '../ui/i18n';
import { declareHelpTopic, routeTopic } from './helpTopic';
import { useKeyLabel } from './keys';
import { useRouter } from './router';
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
  /**
   * The manual's topic for this screen, opened by the "?" button and F1 (see HELP_TOPICS).
   * Defaults to the route's topic (ROUTE_TOPICS); false hides the button.
   */
  helpTopic?: string | false;
}

/**
 * The bar at the top of every project screen: title, the screen's actions, Help, Undo and Redo.
 * When the window is too narrow for all of it, the actions wrap onto a second row rather than
 * covering the title.
 */
export function ScreenHeader({ title, subtitle, actions, leading, undo = true, helpTopic }: ScreenHeaderProps) {
  const { t } = useI18n();
  const { route, go } = useRouter();
  const topic = helpTopic === false ? null : (helpTopic ?? routeTopic(route.name));
  useEffect(() => (topic ? declareHelpTopic(topic) : undefined), [topic]);
  return (
    <header className="screen-header">
      <div className="screen-header__start">
        {leading}
        <div className="screen-header__titles">
          <h1 className="screen-header__title">{title}</h1>
          {subtitle ? <div className="screen-header__subtitle">{subtitle}</div> : null}
        </div>
      </div>
      <div className="screen-header__end">
        {actions ? <div className="screen-header__actions">{actions}</div> : null}
        {topic || undo ? (
          <div className="screen-header__app">
            {topic ? (
              <IconButton icon={CircleHelp} label={t('app.help.button')} shortcut="F1" onClick={() => go({ name: 'help', topic })} data-testid="header-help" />
            ) : null}
            {undo ? <UndoRedo /> : null}
          </div>
        ) : null}
      </div>
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

