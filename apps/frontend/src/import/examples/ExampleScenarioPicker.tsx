import { useMemo, useState } from 'react';
import type { ExampleScenario, ExampleScenarioType } from './types';
import { groupScenariosByType } from './types';

const PANEL_CLASSES =
  'fixed inset-0 z-30 flex items-end justify-end bg-slate-900/40 px-4 pb-6 pt-12 backdrop-blur-sm sm:items-start sm:pt-20';

const DRAWER_CLASSES =
  'w-full max-w-4xl rounded-3xl border border-slate-200/80 bg-white/95 shadow-2xl shadow-slate-900/20 ring-1 ring-white/40 backdrop-blur lg:grid lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] dark:border-slate-700/80 dark:bg-slate-900/90';

const SECTION_HEADER_CLASSES =
  'text-xs font-semibold uppercase tracking-[0.35em] text-slate-500 dark:text-slate-400';

const SCENARIO_CARD_CLASSES =
  'flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white/60 p-4 transition hover:border-violet-400 hover:bg-violet-50/80 dark:border-slate-700/70 dark:bg-slate-900/70 dark:hover:border-violet-300/60 dark:hover:bg-slate-800/80';

const TAG_CLASSES =
  'inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500 dark:bg-slate-800/80 dark:text-slate-300';

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
  const baseClasses =
    'inline-flex w-full items-center justify-between rounded-full px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500';
  const activeClasses = 'bg-violet-600 text-white shadow-lg shadow-violet-500/20 dark:bg-violet-500/30';
  const inactiveClasses =
    'bg-white/70 text-slate-600 hover:bg-violet-500/10 hover:text-violet-700 dark:bg-slate-800/70 dark:text-slate-200 dark:hover:bg-slate-700/70 dark:hover:text-slate-100';
  return (
    <button
      type="button"
      className={`${baseClasses} ${isActive ? activeClasses : inactiveClasses}`}
      onClick={onClick}
    >
      <span>{TYPE_LABELS[type]}</span>
      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{count}</span>
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
    <article className={`${SCENARIO_CARD_CLASSES} ${isActive ? 'ring-2 ring-violet-500/60' : ''}`}>
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{scenario.title}</h3>
          {scenario.difficulty && (
            <span className={TAG_CLASSES}>{DIFFICULTY_LABELS[scenario.difficulty]}</span>
          )}
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300">{scenario.summary}</p>
      </header>
      <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">{scenario.description}</p>
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
        <div className="flex flex-col gap-2 text-xs text-slate-500 dark:text-slate-400">
          {includedScenarios.length > 0 ? (
            <div className="flex flex-col gap-1">
              <span className={SECTION_HEADER_CLASSES}>Loads the following</span>
              <ul className="flex flex-col gap-1">
                {includedScenarios.map((included) => (
                  <li key={included.id} className="text-slate-600 dark:text-slate-300">
                    <strong className="text-slate-700 dark:text-slate-100">{included.title}</strong>
                    <span className="ml-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-400 dark:text-slate-500">
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
                  className="inline-flex items-center gap-1 font-semibold text-violet-600 transition-colors hover:text-violet-500 dark:text-violet-300 dark:hover:text-violet-200"
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
                  <li key={asset.label} className="text-slate-600 dark:text-slate-300">
                    {asset.href ? (
                      <a
                        className="inline-flex items-center gap-1 font-semibold text-violet-600 transition-colors hover:text-violet-500 dark:text-violet-300 dark:hover:text-violet-200"
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
          className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-violet-500/30 transition hover:bg-violet-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
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

  return (
    <div className={PANEL_CLASSES} role="dialog" aria-modal="true">
      <div className={DRAWER_CLASSES}>
        <aside className="flex flex-col gap-4 border-b border-slate-200/70 p-5 lg:border-b-0 lg:border-r dark:border-slate-700/70">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <span className={SECTION_HEADER_CLASSES}>Example scenarios</span>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Jump straight into a seeded workflow</h2>
            </div>
            <button
              type="button"
              className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              onClick={onClose}
            >
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
          <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
            Forms are pre-populated with curated examples from this repository. You can adjust any field before running a
            preview or import.
          </p>
        </aside>
        <section className="flex max-h-[70vh] flex-col gap-4 overflow-auto px-5 py-6">
          {scenarioList.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No scenarios available for this category yet.</p>
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
      </div>
    </div>
  );
}
