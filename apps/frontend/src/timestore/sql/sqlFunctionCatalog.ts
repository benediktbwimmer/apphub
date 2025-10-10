import type { SqlEditorMode } from '../types';

export type SqlFunctionDescriptor = {
  name: string;
  signature: string;
  description?: string;
  snippet?: string;
};

const COMMON_FUNCTIONS: SqlFunctionDescriptor[] = [
  { name: 'avg', signature: 'avg(expression)', description: 'Average value of the expression.' },
  { name: 'sum', signature: 'sum(expression)', description: 'Sum of non-null values.' },
  { name: 'min', signature: 'min(expression)', description: 'Minimum value.' },
  { name: 'max', signature: 'max(expression)', description: 'Maximum value.' },
  { name: 'count', signature: 'count(*)', description: 'Count rows in the current scope.' },
  { name: 'count_distinct', signature: 'count_distinct(expression)', description: 'Count distinct values.' },
  { name: 'median', signature: 'median(expression)', description: 'Median value (50th percentile).' },
  { name: 'percentile', signature: 'percentile(expression, p)', description: 'Approximate percentile p (0-1).' },
  { name: 'coalesce', signature: 'coalesce(value, ...)', description: 'First non-null argument.' },
  { name: 'greatest', signature: 'greatest(value1, value2, ...)', description: 'Largest value among the arguments.' },
  { name: 'least', signature: 'least(value1, value2, ...)', description: 'Smallest value among the arguments.' },
  { name: 'date_trunc', signature: "date_trunc('unit', timestamp)", description: 'Truncate timestamp to a specific unit.' }
];

const TIMESTORE_FUNCTIONS: SqlFunctionDescriptor[] = [
  { name: 'lag', signature: 'lag(expression [, offset [, default]])', description: 'Value from a previous row in the current ordering.' },
  { name: 'lead', signature: 'lead(expression [, offset [, default]])', description: 'Value from a following row in the current ordering.' }
];

const CLICKHOUSE_FUNCTIONS: SqlFunctionDescriptor[] = [
  { name: 'quantile', signature: 'quantile(level)(expression)', description: 'Approximate quantile with level (0-1).' },
  { name: 'quantileExact', signature: 'quantileExact(level)(expression)', description: 'Exact quantile using level (0-1).' },
  { name: 'uniq', signature: 'uniq(expression)', description: 'Approximate distinct count.' },
  { name: 'uniqExact', signature: 'uniqExact(expression)', description: 'Exact distinct count.' },
  { name: 'argMax', signature: 'argMax(expression, weight)', description: 'Value of expression for maximal weight.' },
  { name: 'argMin', signature: 'argMin(expression, weight)', description: 'Value of expression for minimal weight.' },
  { name: 'movingAvg', signature: 'movingAvg(expression, window)', description: 'Moving average over the specified window.' },
  { name: 'runningDifference', signature: 'runningDifference(expression)', description: 'Difference between consecutive rows in sort order.' }
];

export function getSqlFunctionCatalog(mode: SqlEditorMode): SqlFunctionDescriptor[] {
  const base = [...COMMON_FUNCTIONS];
  if (mode === 'timestore') {
    base.push(...TIMESTORE_FUNCTIONS);
  } else {
    base.push(...CLICKHOUSE_FUNCTIONS);
  }
  return base;
}
