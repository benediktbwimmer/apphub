export type NavLink = {
  href: string;
  label: string;
  description: string;
};

export const navLinks: NavLink[] = [
  {
    href: '/',
    label: 'Platform',
    description: 'Overview of the Osiris AppHub operations platform.'
  },
  {
    href: '/business',
    label: 'For Business Leaders',
    description: 'Business value pillars and ROI hypotheses.'
  },
  {
    href: '/technical',
    label: 'For Engineering Teams',
    description: 'Technical architecture, integration surfaces, and security posture.'
  },
  {
    href: '/adoption',
    label: 'Adoption Services',
    description: 'Rollout playbooks, enablement support, and engagement tiers.'
  },
  {
    href: '/module-sdk',
    label: 'Module SDK',
    description: 'Code snippets and cookbook for module authors.'
  },
  {
    href: '/funding',
    label: 'Funding',
    description: 'Support AppHub through donations, sponsorships, and paid collaborations.'
  }
];
