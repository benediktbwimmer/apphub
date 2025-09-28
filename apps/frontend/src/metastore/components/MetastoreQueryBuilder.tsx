import type { QueryClause, QueryField, QueryOperator } from '../queryComposer';
import { createEmptyClause, sanitizeClauses } from '../queryComposer';

type QueryBuilderProps = {
  clauses: QueryClause[];
  onChange: (clauses: QueryClause[]) => void;
};

const FIELD_LABELS: Record<QueryField, string> = {
  key: 'Key',
  owner: 'Owner',
  tags: 'Tags',
  metadata: 'Metadata Path'
};

const FIELD_OPERATORS: Record<QueryField, QueryOperator[]> = {
  key: ['equals', 'notEquals'],
  owner: ['equals', 'notEquals', 'exists'],
  tags: ['includesAny'],
  metadata: ['equals', 'notEquals', 'contains', 'exists']
};

const OPERATOR_LABELS: Record<QueryOperator, string> = {
  equals: 'Equals',
  notEquals: 'Does not equal',
  includesAny: 'Includes any of',
  contains: 'Contains value',
  exists: 'Exists'
};

const FIELD_PLACEHOLDERS: Record<QueryField, string> = {
  key: 'e.g. dataset/users',
  owner: 'team@apphub.dev',
  tags: 'marketing, beta',
  metadata: 'status'
};

function resetOperatorForField(field: QueryField): QueryOperator {
  const [first] = FIELD_OPERATORS[field];
  return first ?? 'equals';
}

export function MetastoreQueryBuilder({ clauses, onChange }: QueryBuilderProps) {
  const handleFieldChange = (id: string, nextField: QueryField) => {
    onChange(
      clauses.map((clause) =>
        clause.id === id
          ? {
              ...clause,
              field: nextField,
              operator: FIELD_OPERATORS[nextField].includes(clause.operator)
                ? clause.operator
                : resetOperatorForField(nextField),
              value: nextField === 'tags' ? clause.value : clause.value,
              path: nextField === 'metadata' ? clause.path ?? '' : undefined
            }
          : clause
      )
    );
  };

  const handleOperatorChange = (id: string, operator: QueryOperator) => {
    onChange(
      clauses.map((clause) =>
        clause.id === id
          ? {
              ...clause,
              operator,
              value: operator === 'exists' && clause.field !== 'tags' ? '' : clause.value
            }
          : clause
      )
    );
  };

  const handleValueChange = (id: string, value: string) => {
    onChange(
      clauses.map((clause) => (clause.id === id ? { ...clause, value } : clause))
    );
  };

  const handlePathChange = (id: string, path: string) => {
    onChange(
      clauses.map((clause) => (clause.id === id ? { ...clause, path } : clause))
    );
  };

  const handleRemove = (id: string) => {
    const next = clauses.filter((clause) => clause.id !== id);
    onChange(sanitizeClauses(next));
  };

  const handleAdd = () => {
    onChange([...clauses, createEmptyClause()]);
  };

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {clauses.map((clause) => {
          const operators = FIELD_OPERATORS[clause.field];
          const requiresValue = clause.operator !== 'exists' || clause.field === 'tags';
          const requiresPath = clause.field === 'metadata';
          return (
            <li
              key={clause.id}
              className="flex flex-col gap-2 rounded-2xl border border-slate-200/70 bg-white/80 p-3 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/70"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <label className="flex flex-col text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
                  Field
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-violet-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    value={clause.field}
                    onChange={(event) => handleFieldChange(clause.id, event.target.value as QueryField)}
                  >
                    {(Object.keys(FIELD_LABELS) as QueryField[]).map((field) => (
                      <option key={field} value={field}>
                        {FIELD_LABELS[field]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
                  Operator
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-violet-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    value={clause.operator}
                    onChange={(event) => handleOperatorChange(clause.id, event.target.value as QueryOperator)}
                  >
                    {operators.map((operator) => (
                      <option key={operator} value={operator}>
                        {OPERATOR_LABELS[operator]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                {requiresPath && (
                  <label className="flex w-full flex-col text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
                    Path
                    <input
                      type="text"
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-violet-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      placeholder="metadata.status"
                      value={clause.path ?? ''}
                      onChange={(event) => handlePathChange(clause.id, event.target.value)}
                    />
                  </label>
                )}
                {requiresValue && (
                  <label className="flex w-full flex-col text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
                    Value
                    <input
                      type="text"
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-violet-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      placeholder={FIELD_PLACEHOLDERS[clause.field]}
                      value={clause.value}
                      onChange={(event) => handleValueChange(clause.id, event.target.value)}
                    />
                  </label>
                )}
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>
                  {clause.field === 'tags'
                    ? 'Separate multiple tags with commas.'
                    : clause.field === 'metadata'
                      ? 'Metadata paths map to JSON keys (e.g., status, attributes.state).'
                      : 'String matching is case sensitive.'}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemove(clause.id)}
                  className="rounded-full px-3 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/20"
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={handleAdd}
        className="self-start rounded-full border border-violet-500 px-4 py-2 text-sm font-semibold text-violet-600 transition-colors hover:bg-violet-500/10 dark:border-violet-400 dark:text-violet-300"
      >
        Add condition
      </button>
    </div>
  );
}
