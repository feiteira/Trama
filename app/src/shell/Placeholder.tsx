import React from 'react';
import { Hammer } from 'lucide-react';
import { useI18n } from '../ui/i18n';
import { EmptyState } from '../ui/components/Feedback';
import type { RouteName } from './router';
import { navItem } from './nav';
import { ScreenHeader } from './ScreenHeader';

/** A screen still being built: its header and a short note. Replaced by the real screen. */
export function Placeholder({ name }: { name: RouteName }) {
  const { t } = useI18n();
  const item = navItem(name);
  return (
    <>
      <ScreenHeader title={t(item.label)} />
      <div className="placeholder" data-testid={`screen-${name}`}>
        <EmptyState icon={item.icon ?? Hammer} title={t(item.label)}>
          {t('app.placeholder')}
        </EmptyState>
      </div>
    </>
  );
}
