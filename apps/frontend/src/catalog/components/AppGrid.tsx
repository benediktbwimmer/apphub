import { useMemo } from 'react';
import AppSummaryCard from './AppSummaryCard';
import { usePreviewLayout } from '../../settings/previewLayoutContext';
import type { AppRecord } from '../types';

type AppGridProps = {
  apps: AppRecord[];
  activeTokens: string[];
  highlightEnabled: boolean;
  selectedAppId: string | null;
  onSelectApp: (id: string) => void;
};

function AppGrid({
  apps,
  activeTokens,
  highlightEnabled,
  selectedAppId,
  onSelectApp
}: AppGridProps) {
  const { width } = usePreviewLayout();

  const gridTemplateColumns = useMemo(() => {
    const clampedWidth = Math.round(width);
    return `repeat(auto-fit, minmax(${clampedWidth}px, 1fr))`;
  }, [width]);

  return (
    <div className="grid gap-6" style={{ gridTemplateColumns }}>
      {apps.map((app) => (
        <AppSummaryCard
          key={app.id}
          app={app}
          activeTokens={activeTokens}
          highlightEnabled={highlightEnabled}
          onOpenDetails={onSelectApp}
          isActive={selectedAppId === app.id}
        />
      ))}
    </div>
  );
}

export default AppGrid;
