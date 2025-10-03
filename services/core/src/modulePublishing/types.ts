export type ModulePublishStage = 'queued' | 'publishing' | 'completed' | 'failed';

export type ModulePublishState = 'queued' | 'running' | 'completed' | 'failed';

export function stageToState(stage: ModulePublishStage): ModulePublishState {
  switch (stage) {
    case 'failed':
      return 'failed';
    case 'completed':
      return 'completed';
    case 'queued':
      return 'queued';
    default:
      return 'running';
  }
}
