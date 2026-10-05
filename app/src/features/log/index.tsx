import React from 'react';
import type { ScreenProps } from '../../shell/router';
import { Placeholder } from '../../shell/Placeholder';

// PLACEHOLDER (app shell): replaced by the real screen. Keep the default export and its props.
export default function LogScreen(_props: ScreenProps<'log'>) {
  return <Placeholder name="log" />;
}
