import {
  BookOpenText, ChartNetwork, CircleHelp, FileDown, Highlighter, History, type LucideIcon, NotebookPen, Package, Scale, Settings, Tags, Users,
  VenetianMask,
} from 'lucide-react';
import type { MessageKey } from '../ui/i18n';
import type { RouteName } from './router';

// The project's destinations, in the order of the navigation rail.

export type NavGroup = 'work' | 'analyse' | 'project' | 'foot';

export interface NavItem {
  name: RouteName;
  icon: LucideIcon;
  label: MessageKey;
  group: NavGroup;
}

export const NAV: readonly NavItem[] = [
  { name: 'workbench', icon: BookOpenText, label: 'app.nav.workbench', group: 'work' },
  { name: 'codes', icon: Tags, label: 'app.nav.codes', group: 'work' },
  { name: 'segments', icon: Highlighter, label: 'app.nav.segments', group: 'work' },
  { name: 'memos', icon: NotebookPen, label: 'app.nav.memos', group: 'work' },
  { name: 'cases', icon: Users, label: 'app.nav.cases', group: 'work' },
  { name: 'analysis', icon: ChartNetwork, label: 'app.nav.analysis', group: 'analyse' },
  { name: 'agreement', icon: Scale, label: 'app.nav.agreement', group: 'analyse' },
  { name: 'import', icon: FileDown, label: 'app.nav.import', group: 'project' },
  { name: 'project', icon: Package, label: 'app.nav.project', group: 'project' },
  { name: 'pseudonyms', icon: VenetianMask, label: 'app.nav.pseudonyms', group: 'project' },
  { name: 'log', icon: History, label: 'app.nav.log', group: 'project' },
  { name: 'settings', icon: Settings, label: 'app.nav.settings', group: 'foot' },
  { name: 'help', icon: CircleHelp, label: 'app.nav.help', group: 'foot' },
];

export const navItem = (name: RouteName): NavItem => NAV.find((n) => n.name === name)!;
