import type { FC } from 'react';

type ScenarioOption = {
  id: string;
  title: string;
};

type ScenarioSwitcherProps = {
  options: ScenarioOption[];
  activeId: string | null;
  onSelect?: (id: string) => void;
};

const ACTIVE_PILL_CLASSES =
  'inline-flex items-center gap-2 rounded-full bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-violet-500/30';

const INACTIVE_PILL_CLASSES =
  'inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-300 transition hover:bg-violet-50 hover:text-violet-700 dark:bg-slate-900/70 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800 dark:hover:text-violet-200';

export const ScenarioSwitcher: FC<ScenarioSwitcherProps> = ({ options, activeId, onSelect }) => {
  if (!onSelect || options.length <= 1) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-slate-200/70 bg-white/70 p-3 text-xs shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60">
      <span className="font-semibold uppercase tracking-[0.35em] text-slate-500 dark:text-slate-400">Loaded scenarios</span>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isActive = option.id === activeId;
          return (
            <button
              key={option.id}
              type="button"
              className={isActive ? ACTIVE_PILL_CLASSES : INACTIVE_PILL_CLASSES}
              onClick={() => onSelect(option.id)}
            >
              {option.title}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export type { ScenarioOption, ScenarioSwitcherProps };
