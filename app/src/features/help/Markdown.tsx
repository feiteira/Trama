import React, { Fragment, memo, type ReactNode } from 'react';
import type { Block, Inline } from '../../core/text/markdown';
import { Kbd } from '../../ui/components/Feedback';
import { Tooltip } from '../../ui/components/Tooltip';
import { groupBlocks, isKeyLabel, listTree, macKeys, type ListNode } from './render';

export interface MarkdownProps {
  blocks: Block[];
  /** Turns a link written in the manual into a place in Help; null for web addresses. */
  linkTarget: (href: string) => string | null;
  onLink: (href: string) => void;
  /** Bundled URL of an image, or null to leave it out (no screenshot yet). */
  image: (src: string) => string | null;
  /** Show keys the Mac way (⌘ for Ctrl). */
  mac: boolean;
  /** Explains why a web address cannot be opened. */
  externalHint: string;
  /** The heading's DOM id for an anchor (ids are prefixed so they cannot clash with the app's). */
  idOf: (anchor: string) => string;
}

/** The manual's Markdown as React elements, styled by help.css for reading. */
export const Markdown = memo(function Markdown(props: MarkdownProps) {
  const groups = groupBlocks(props.blocks);
  return (
    <>
      {groups.map((g, i) => {
        if (g.t === 'quotes') {
          return (
            <aside key={i} className="manual__note">
              {g.items.map((q, j) => (
                <p key={j}>
                  <Inlines nodes={q} {...props} />
                </p>
              ))}
            </aside>
          );
        }
        return <BlockView key={i} b={g.b} {...props} />;
      })}
    </>
  );
});

function BlockView({ b, ...props }: { b: Block } & MarkdownProps) {
  switch (b.t) {
    case 'heading': {
      const Tag = (`h${Math.min(4, Math.max(1, b.level))}` as 'h1' | 'h2' | 'h3' | 'h4');
      return (
        <Tag className={`manual__h${b.level}`} id={b.anchor ? props.idOf(b.anchor) : undefined} tabIndex={b.anchor ? -1 : undefined}>
          <Inlines nodes={b.c} {...props} />
        </Tag>
      );
    }
    case 'para':
      return (
        <p className="manual__p">
          <Inlines nodes={b.c} {...props} />
        </p>
      );
    case 'list':
      return <ListView nodes={listTree(b.items)} ordered={b.ordered} {...props} />;
    case 'table':
      return (
        <div className="manual__table-wrap">
          <table className="manual__table">
            <thead>
              <tr>
                {b.head.map((c, i) => (
                  <th key={i} scope="col">
                    <Inlines nodes={c} {...props} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((c, i) => (
                    <td key={i}>
                      <Inlines nodes={c} {...props} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'image': {
      const url = props.image(b.src);
      if (!url) return null;
      return (
        <figure className="manual__figure">
          <img src={url} alt={b.alt} loading="lazy" decoding="async" />
        </figure>
      );
    }
    case 'code':
      return (
        <pre className="manual__pre">
          <code>{b.v}</code>
        </pre>
      );
    case 'rule':
      return <hr className="manual__rule" />;
    case 'quote':
      return (
        <aside className="manual__note">
          <p>
            <Inlines nodes={b.c} {...props} />
          </p>
        </aside>
      );
  }
}

function ListView({ nodes, ordered, ...props }: { nodes: ListNode[]; ordered: boolean } & MarkdownProps) {
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <Tag className={ordered ? 'manual__ol' : 'manual__ul'}>
      {nodes.map((n, i) => (
        <li key={i}>
          <Inlines nodes={n.c} {...props} />
          {n.children.length ? <ListView nodes={n.children} ordered={false} {...props} /> : null}
        </li>
      ))}
    </Tag>
  );
}

function Inlines({ nodes, ...props }: { nodes: Inline[] } & MarkdownProps): ReactNode {
  return nodes.map((n, i) => <Fragment key={i}>{inline(n, props)}</Fragment>);
}

function inline(n: Inline, props: MarkdownProps): ReactNode {
  switch (n.t) {
    case 'text':
      return n.v;
    case 'bold':
      return (
        <strong>
          <Inlines nodes={n.c} {...props} />
        </strong>
      );
    case 'italic':
      return (
        <em>
          <Inlines nodes={n.c} {...props} />
        </em>
      );
    case 'strike':
      return (
        <s>
          <Inlines nodes={n.c} {...props} />
        </s>
      );
    case 'code':
      // Keys are written as code in the manual (`Ctrl+K`): shown as keys, the Mac way on a Mac.
      return isKeyLabel(n.v) ? <Kbd className="manual__kbd">{props.mac ? macKeys(n.v) : n.v}</Kbd> : <code className="manual__code">{n.v}</code>;
    case 'link': {
      const target = props.linkTarget(n.href);
      if (target) {
        return (
          <a
            className="manual__link"
            href={`#help/${target}`}
            onClick={(e) => {
              e.preventDefault();
              props.onLink(n.href);
            }}
          >
            <Inlines nodes={n.c} {...props} />
          </a>
        );
      }
      // No network: a web address is shown, not opened.
      return (
        <Tooltip label={props.externalHint}>
          <span className="manual__ext" tabIndex={0}>
            <Inlines nodes={n.c} {...props} />
            {/^https?:/.test(n.href) && n.href.replace(/^https?:\/\//, '').replace(/\/$/, '') !== textOf(n.c) ? <span className="manual__url"> ({n.href.replace(/^https?:\/\//, '').replace(/\/$/, '')})</span> : null}
          </span>
        </Tooltip>
      );
    }
  }
}

const textOf = (c: Inline[]): string => c.map((n) => (n.t === 'text' || n.t === 'code' ? n.v : textOf(n.c))).join('');
