import type { FC } from 'react';
import {
  CARD_SECTION,
  SECTION_LABEL,
  SEGMENTED_BUTTON_ACTIVE,
  SEGMENTED_BUTTON_BASE,
  SEGMENTED_BUTTON_INACTIVE
} from '../importTokens';

type ScenarioOption = {
  id: string;
  title: string;
};

type ScenarioSwitcherProps = {
  options: ScenarioOption[];
  activeId: string | null;
  onSelect?: (id: string) => void;
};

const segmentedButtonClass = (active: boolean): string =>
  `${SEGMENTED_BUTTON_BASE} px-3 py-1.5 text-scale-xs ${active ? SEGMENTED_BUTTON_ACTIVE : SEGMENTED_BUTTON_INACTIVE}`;

export const ScenarioSwitcher: FC<ScenarioSwitcherProps> = ({ options, activeId, onSelect }) => {
  if (!onSelect || options.length <= 1) {
    return null;
  }
  return (
    <div className={`${CARD_SECTION} gap-2 text-scale-xs`}>
      <span className={SECTION_LABEL}>Loaded scenarios</span>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isActive = option.id === activeId;
          return (
            <button
              key={option.id}
              type="button"
              className={segmentedButtonClass(isActive)}
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
