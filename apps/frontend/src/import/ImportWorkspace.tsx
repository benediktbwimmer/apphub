import { useState } from 'react';
import ServiceManifestsTab from './tabs/ServiceManifestsTab';
import ImportAppsTab from './tabs/ImportAppsTab';
import ImportJobBundleTab from './tabs/ImportJobBundleTab';
import ImportWorkflowTab from './tabs/ImportWorkflowTab';
import {
  HEADING_PRIMARY,
  SUBTEXT,
  STEP_CARD_BASE,
  STEP_CARD_ACTIVE,
  STEP_CARD_PENDING,
  SECTION_LABEL,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON_LARGE
} from './importTokens';

const STEPS = ['service-manifests', 'builds', 'jobs', 'workflows'] as const;

const STEP_LABELS: Record<(typeof STEPS)[number], string> = {
  'service-manifests': 'Service manifests',
  builds: 'Builds',
  jobs: 'Jobs',
  workflows: 'Workflows'
};

const STEP_DESCRIPTIONS: Record<(typeof STEPS)[number], string> = {
  'service-manifests': 'Register network and service configuration from manifest descriptors.',
  builds: 'Connect repositories so AppHub can build and launch containers.',
  jobs: 'Upload or reference job bundles to keep automation assets in sync.',
  workflows: 'Create workflow definitions and validate trigger dependencies.'
};

type ImportWizardStep = (typeof STEPS)[number];

type ImportWorkspaceProps = {
  onAppRegistered?: (id: string) => void;
  onManifestImported?: () => void;
  onViewCore?: () => void;
};

function StepButton({
  step,
  label,
  description,
  activeStep,
  onSelect
}: {
  step: ImportWizardStep;
  label: string;
  description: string;
  activeStep: ImportWizardStep;
  onSelect: (step: ImportWizardStep) => void;
}) {
  const isActive = activeStep === step;
  const baseClass = STEP_CARD_BASE;
  const activeClass = isActive ? STEP_CARD_ACTIVE : '';
  const statusClass = isActive ? '' : STEP_CARD_PENDING;
  return (
    <button
      type="button"
      className={`${baseClass} ${activeClass} ${statusClass}`}
      onClick={() => onSelect(step)}
    >
      <span className={SECTION_LABEL}>{label}</span>
      <span className={SUBTEXT}>{description}</span>
    </button>
  );
}

export default function ImportWorkspace({
  onAppRegistered,
  onManifestImported,
  onViewCore
}: ImportWorkspaceProps) {
  const [activeStep, setActiveStep] = useState<ImportWizardStep>('service-manifests');

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className={HEADING_PRIMARY}>Import workspace assets</h1>
        <p className={SUBTEXT}>
          Seed your AppHub environment with services, builds, job bundles, and workflows. Pick a category below and follow the
          guided form to upload configuration manually.
        </p>
      </header>

      <div className="grid gap-3 lg:grid-cols-4">
        {STEPS.map((step) => (
          <StepButton
            key={step}
            step={step}
            label={STEP_LABELS[step]}
            description={STEP_DESCRIPTIONS[step]}
            activeStep={activeStep}
            onSelect={setActiveStep}
          />
        ))}
      </div>

      <section>
        {activeStep === 'service-manifests' && (
          <ServiceManifestsTab onImported={onManifestImported} />
        )}
        {activeStep === 'builds' && <ImportAppsTab onAppRegistered={onAppRegistered} onViewCore={onViewCore} />}
        {activeStep === 'jobs' && <ImportJobBundleTab />}
        {activeStep === 'workflows' && <ImportWorkflowTab />}
      </section>

      <footer className="flex flex-wrap gap-3">
        <button type="button" className={PRIMARY_BUTTON} onClick={() => setActiveStep('service-manifests')}>
          Start with service manifests
        </button>
        <button type="button" className={SECONDARY_BUTTON_LARGE} onClick={() => setActiveStep('builds')}>
          Jump to builds
        </button>
      </footer>
    </div>
  );
}
