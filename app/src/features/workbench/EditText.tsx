import React, { useEffect, useRef } from 'react';
import { Notice } from '../../ui/components/Feedback';
import { useI18n } from '../../ui/i18n';

// Editing a document's text (typos, a name to pseudonymise by hand). Codings are remapped to
// follow the words they cover when the edit is saved; passages deleted outright lose their
// coding, which the warning says before anything is changed.

export interface EditTextProps {
  value: string;
  onChange: (v: string) => void;
  codings: number;
  fontSize: number;
  onSave: () => void;
  onCancel: () => void;
}

export function EditText({ value, onChange, codings, fontSize, onSave, onCancel }: EditTextProps) {
  const { t, tp } = useI18n();
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(0, 0);
    el.scrollTop = 0;
  }, []);
  return (
    <div className="wb-edit" data-testid="edit-text">
      <Notice tone="warning" title={t('workbench.edit.warningTitle')} className="wb-edit__notice">
        {codings ? tp('workbench.edit.warningBody', codings) : t('workbench.edit.warningNoCodings')}
      </Notice>
      <textarea
        ref={area}
        className="wb-edit__area"
        style={{ fontSize }}
        value={value}
        spellCheck
        aria-label={t('workbench.edit.label')}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            onSave();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        data-testid="edit-textarea"
      />
    </div>
  );
}
