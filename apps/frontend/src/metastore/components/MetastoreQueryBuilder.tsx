import classNames from 'classnames';
import type { QueryClause, QueryField, QueryOperator } from '../queryComposer';
import { createEmptyClause, sanitizeClauses } from '../queryComposer';
import {
  METASTORE_FORM_FIELD_CONTAINER_CLASSES,
  METASTORE_INPUT_FIELD_CLASSES,
  METASTORE_META_TEXT_CLASSES,
  METASTORE_PRIMARY_BUTTON_CLASSES,
  METASTORE_SECONDARY_BUTTON_SMALL_CLASSES,
  METASTORE_SECTION_LABEL_CLASSES,
  METASTORE_SELECT_CLASSES
} from '../metastoreTokens';

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
              className={classNames(METASTORE_FORM_FIELD_CONTAINER_CLASSES, 'flex flex-col gap-3')}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <label className="flex w-full flex-col gap-2 text-secondary">
                  <span className={METASTORE_SECTION_LABEL_CLASSES}>Field</span>
                  <select
                    className={classNames(METASTORE_SELECT_CLASSES, 'w-full')}
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
                <label className="flex w-full flex-col gap-2 text-secondary">
                  <span className={METASTORE_SECTION_LABEL_CLASSES}>Operator</span>
                  <select
                    className={classNames(METASTORE_SELECT_CLASSES, 'w-full')}
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
                  <label className="flex w-full flex-col gap-2 text-secondary">
                    <span className={METASTORE_SECTION_LABEL_CLASSES}>Path</span>
                    <input
                      type="text"
                      className={classNames(METASTORE_INPUT_FIELD_CLASSES, 'w-full')}
                      placeholder="metadata.status"
                      value={clause.path ?? ''}
                      onChange={(event) => handlePathChange(clause.id, event.target.value)}
                    />
                  </label>
                )}
                {requiresValue && (
                  <label className="flex w-full flex-col gap-2 text-secondary">
                    <span className={METASTORE_SECTION_LABEL_CLASSES}>Value</span>
                    <input
                      type="text"
                      className={classNames(METASTORE_INPUT_FIELD_CLASSES, 'w-full')}
                      placeholder={FIELD_PLACEHOLDERS[clause.field]}
                      value={clause.value}
                      onChange={(event) => handleValueChange(clause.id, event.target.value)}
                    />
                  </label>
                )}
              </div>
              <div className={classNames('flex items-center justify-between gap-3', METASTORE_META_TEXT_CLASSES)}>
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
                  className={classNames(
                    METASTORE_SECONDARY_BUTTON_SMALL_CLASSES,
                    'border-status-danger text-status-danger hover:border-status-danger hover:bg-status-danger-soft/40 hover:text-status-danger'
                  )}
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
        className={classNames(METASTORE_PRIMARY_BUTTON_CLASSES, 'self-start')}
      >
        Add condition
      </button>
    </div>
  );
}
