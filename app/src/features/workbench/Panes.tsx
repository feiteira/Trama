import React, { type ReactNode } from 'react';
import { SplitPane } from '../../ui/components/SplitPane';

// The workbench's three panes: documents | viewer | codebook. Both dividers are the design
// system's SplitPane; the right one sizes its second pane, so the codebook keeps its width
// while the window grows.

export interface WorkbenchPanesProps {
  left: ReactNode;
  centre: ReactNode;
  right: ReactNode;
  leftOpen: boolean;
  rightOpen: boolean;
  leftLabel: string;
  rightLabel: string;
}

export function WorkbenchPanes({ left, centre, right, leftOpen, rightOpen, leftLabel, rightLabel }: WorkbenchPanesProps) {
  const inner = rightOpen ? (
    <SplitPane
      first={centre}
      second={right}
      sized="second"
      initial={264}
      min={200}
      max={460}
      minRest={380}
      storageKey="workbench.right"
      label={rightLabel}
      className="wb-panes__right"
      handleTestId="workbench-right-divider"
    />
  ) : (
    centre
  );
  if (!leftOpen) return <div className="wb-panes">{inner}</div>;
  return (
    <div className="wb-panes">
      <SplitPane
        first={left}
        second={inner}
        initial={240}
        min={180}
        max={440}
        minRest={rightOpen ? 600 : 380}
        storageKey="workbench.left"
        label={leftLabel}
        className="wb-panes__split"
        data-testid="workbench-panes"
      />
    </div>
  );
}
