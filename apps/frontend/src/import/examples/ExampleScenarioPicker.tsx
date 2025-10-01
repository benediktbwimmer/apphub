import { useMemo, useState } from 'react';
import { Modal } from '../../components';
import {
  BODY_TEXT,
  CARD_SURFACE,
  CARD_SURFACE_ACTIVE,
  DRAWER_SURFACE,
  FILTER_BUTTON_ACTIVE,
  FILTER_BUTTON_BASE,
  FILTER_BUTTON_INACTIVE,
  HEADING_SECONDARY,
  LINK_ACCENT,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SECTION_LABEL,
  SUBTEXT,
  TAG_BADGE
} from '../importTokens';
import type { ExampleScenario, ExampleScenarioType } from './types';
import { groupScenariosByType } from './types';

const PANEL_CLASSES = 'items-end justify-end px-4 pb-6 pt-12 sm:items-start sm:pt-20';

const DRAWER_CLASSES = `${DRAWER_SURFACE} max-w-4xl lg:grid lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]`;

const SECTION_HEADER_CLASSES = SECTION_LABEL;

const SCENARIO_CARD_CLASSES = CARD_SURFACE;

const TAG_CLASSES = TAG_BADGE;

type ExampleScenarioPickerProps = {
  open: boolean;
  scenarios: ExampleScenario[];
  activeScenarioIds: Record<ExampleScenarioType, string | null>;
  onClose: () => void;
  onApply: (scenario: ExampleScenario) => void;
};

const TYPE_LABELS: Record<ExampleScenarioType, string> = {
  scenario: 'Scenarios',
  'service-manifest': 'Service manifests',
  app: 'Apps',
  job: 'Jobs',
  workflow: 'Workflows'
};

const ORDERED_TYPES: ExampleScenarioType[] = ['scenario', 'service-manifest', 'app', 'job', 'workflow'];

const DIFFICULTY_LABELS = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced'
} as const;

function TypeFilterButton({
  type,
  isActive,
  count,
  onClick
}: {
  type: ExampleScenarioType;
  isActive: boolean;
  count: number;
  onClick: () => void;
}) {
  const baseClasses = FILTER_BUTTON_BASE;
  const activeClasses = FILTER_BUTTON_ACTIVE;
  const inactiveClasses = FILTER_BUTTON_INACTIVE;
  return (
    <button
      type="button"
      className={`${baseClasses} ${isActive ? activeClasses : inactiveClasses}`}
      onClick={onClick}
    >
      <span>{TYPE_LABELS[type]}</span>
      <span className="text-scale-xs font-weight-semibold text-muted">{count}</span>
    </button>
  );
}

function ScenarioCard({
  scenario,
  onApply,
  isActive,
  lookupScenarioById
}: {
  scenario: ExampleScenario;
  onApply: (scenario: ExampleScenario) => void;
  isActive: boolean;
  lookupScenarioById: (id: string) => ExampleScenario | null;
}) {
  const includedScenarios = scenario.type === 'scenario'
    ? scenario.includes
        .map((id) => lookupScenarioById(id))
        .filter((value): value is ExampleScenario => value !== null)
    : [];

  return (
    <article className={`${SCENARIO_CARD_CLASSES} ${isActive ? CARD_SURFACE_ACTIVE : ''}`}>
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h3 className={HEADING_SECONDARY}>{scenario.title}</h3>
          {scenario.difficulty && (
            <span className={TAG_CLASSES}>{DIFFICULTY_LABELS[scenario.difficulty]}</span>
          )}
        </div>
        <p className={BODY_TEXT}>{scenario.summary}</p>
      </header>
      <p className={`${BODY_TEXT} leading-6`}>{scenario.description}</p>
      {scenario.tags && scenario.tags.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {scenario.tags.map((tag) => (
            <li key={tag} className={TAG_CLASSES}>
              {tag}
            </li>
          ))}
        </ul>
      )}
      {(scenario.docs?.length || scenario.assets?.length || includedScenarios.length > 0) && (
        <div className="flex flex-col gap-2 text-scale-xs text-muted">
          {includedScenarios.length > 0 ? (
            <div className="flex flex-col gap-1">
              <span className={SECTION_HEADER_CLASSES}>Loads the following</span>
              <ul className="flex flex-col gap-1">
                {includedScenarios.map((included) => (
                  <li key={included.id} className="text-secondary">
                    <strong className="text-primary">{included.title}</strong>
                    <span className="ml-2 text-scale-2xs font-weight-semibold uppercase tracking-[0.25em] text-muted">
                      {TYPE_LABELS[included.type] ?? included.type}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {scenario.docs?.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className={SECTION_HEADER_CLASSES}>Further reading</span>
              {scenario.docs.map((doc) => (
                <a
                  key={doc.label}
                  className={LINK_ACCENT}
                  href={doc.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {doc.label}
                  <span aria-hidden="true">→</span>
                </a>
              ))}
            </div>
          ) : null}
          {scenario.assets?.length ? (
            <div className="flex flex-col gap-1">
              <span className={SECTION_HEADER_CLASSES}>Included assets</span>
              <ul className="flex flex-col gap-1">
                {scenario.assets.map((asset) => (
                  <li key={asset.label} className="text-secondary">
                    {asset.href ? (
                      <a
                        className={LINK_ACCENT}
                        href={asset.href}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {asset.label}
                        <span aria-hidden="true">→</span>
                      </a>
                    ) : (
                      <span>{asset.label}</span>
                    )}
                    {asset.description ? <span className="ml-2 text-xs">{asset.description}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
      <footer className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className={PRIMARY_BUTTON}
          onClick={() => onApply(scenario)}
        >
          {isActive ? 'Reload scenario' : 'Load this scenario'}
        </button>
      </footer>
    </article>
  );
}

export function ExampleScenarioPicker({
  open,
  scenarios,
  activeScenarioIds,
  onClose,
  onApply
}: ExampleScenarioPickerProps) {
  const grouped = useMemo(() => groupScenariosByType(scenarios), [scenarios]);
  const [selectedType, setSelectedType] = useState<ExampleScenarioType>(() =>
    scenarios.some((scenario) => scenario.type === 'scenario') ? 'scenario' : 'service-manifest'
  );

  const scenarioList = grouped[selectedType];
  const lookupScenarioById = useMemo(() => {
    const entries = scenarios.map((scenario) => [scenario.id, scenario] as const);
    return new Map(entries);
  }, [scenarios]);

  const getScenarioById = (id: string) => lookupScenarioById.get(id) ?? null;

  if (!open) {
    return null;
  }

  const dialogTitleId = 'example-scenario-picker-title';

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeOnBackdrop={false}
      labelledBy={dialogTitleId}
      className={PANEL_CLASSES}
      contentClassName={`${DRAWER_CLASSES} border-0`}
    >
        <aside className="flex flex-col gap-4 border-b border-subtle p-5 lg:border-b-0 lg:border-r">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <span className={SECTION_HEADER_CLASSES}>Example scenarios</span>
              <h2 id={dialogTitleId} className={HEADING_SECONDARY}>
                Jump straight into a seeded workflow
              </h2>
            </div>
            <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>
              Close
            </button>
          </div>
          <nav className="flex flex-col gap-2">
            {ORDERED_TYPES.filter((type) => grouped[type].length > 0).map((type) => (
              <TypeFilterButton
                key={type}
                type={type}
                count={grouped[type].length}
                isActive={selectedType === type}
                onClick={() => setSelectedType(type)}
              />
            ))}
          </nav>
          <p className={`${SUBTEXT} leading-5`}>
            Forms are pre-populated with curated examples from this repository. You can adjust any field before running a
            preview or import.
          </p>
        </aside>
        <section className="flex max-h-[70vh] flex-col gap-4 overflow-auto px-5 py-6">
          {scenarioList.length === 0 ? (
            <p className={BODY_TEXT}>No scenarios available for this category yet.</p>
          ) : (
            scenarioList.map((scenario) => (
              <ScenarioCard
                key={scenario.id}
                scenario={scenario}
                onApply={onApply}
                isActive={scenario.id === activeScenarioIds[selectedType]}
                lookupScenarioById={getScenarioById}
              />
            ))
          )}
        </section>
    </Modal>
  );
}
