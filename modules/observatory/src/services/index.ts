import { createTargetRegistryFromArray } from '@apphub/module-toolkit';
import { dashboardService } from './dashboard';
import { adminService } from './admin';

export const services = createTargetRegistryFromArray([
  dashboardService,
  adminService
]);

export { dashboardService, adminService };
