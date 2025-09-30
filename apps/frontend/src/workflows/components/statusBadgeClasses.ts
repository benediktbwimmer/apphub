import { getStatusToneClasses } from '../../theme/statusTokens';

export function getStatusBadgeClasses(status: string): string {
  return getStatusToneClasses(status);
}
