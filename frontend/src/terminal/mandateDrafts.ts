import { validMandate, type Mandate } from './portfolio.ts';
import { defaultCustomRules } from './strategyRules.ts';

// Empty condition groups are editable drafts, never executable saved strategies.
function validDraft(value: Mandate) {
  const rules = value?.execution?.kind === 'custom' ? value.execution.rules : null;
  if (rules && Array.isArray(rules.entry?.conditions) && Array.isArray(rules.exit?.conditions) && (!rules.entry.conditions.length || !rules.exit.conditions.length)) {
    const defaults = defaultCustomRules();
    validMandate({ ...value, execution: { ...value.execution!, rules: {
      entry: { ...rules.entry, conditions: rules.entry.conditions.length ? rules.entry.conditions : defaults.entry.conditions },
      exit: { ...rules.exit, conditions: rules.exit.conditions.length ? rules.exit.conditions : defaults.exit.conditions },
    } } });
    return structuredClone(value);
  }
  return validMandate(value);
}

export function readMandateDrafts(raw: string | null, allowIncomplete = true): Mandate[] {
  try {
    const rows: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(rows)) return [];
    const drafts: Mandate[] = [];
    for (const row of rows.slice(0, 20)) {
      try {
        const draft = allowIncomplete ? validDraft(row) : validMandate(row);
        if (!drafts.some(m => m.id === draft.id)) drafts.push(draft);
      } catch { /* A damaged draft does not hide the others. */ }
    }
    return drafts;
  } catch { return []; }
}

export function stashMandateDraft(drafts: Mandate[], draft: Mandate) {
  return [validDraft(draft), ...drafts.filter(m => m.id !== draft.id)].slice(0, 20);
}
