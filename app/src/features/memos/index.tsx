import React from 'react';
import type { ScreenProps } from '../../shell/router';
import { Placeholder } from '../../shell/Placeholder';

// PLACEHOLDER (app shell): replaced by the real screen. Keep the default export and its props.
export default function MemosScreen(_props: ScreenProps<'memos'>) {
  return <Placeholder name="memos" />;
}
