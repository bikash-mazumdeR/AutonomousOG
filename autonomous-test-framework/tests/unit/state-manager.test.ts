import { stateManager } from '../../core/state-manager/StateManager';

describe('StateManager', () => {
  const testProject = 'test-unit-' + Date.now();

  it('should initialize with default state for a new project', async () => {
    await stateManager.initialize(testProject);
    const state = await stateManager.getFullState();

    expect(state.projectId).toBe(testProject);
    expect(state.runId).toBeDefined();
    expect(state.globalStatus).toBe('IDLE');
    expect(state.stages['01-requirement-analyzer'].status).toBe('PENDING');
  });

  it('should generate a fresh runId and clear stage progress on resetForNewRun', async () => {
    await stateManager.initialize(testProject);
    const firstState = await stateManager.getFullState();

    await stateManager.markStageRunning('01-requirement-analyzer');
    await stateManager.markStageCompleted('01-requirement-analyzer', { test: true });
    const completedState = await stateManager.getFullState();
    expect(completedState.stages['01-requirement-analyzer'].status).toBe('COMPLETED');

    await new Promise((r) => setTimeout(r, 20));

    const freshState = await stateManager.resetForNewRun(testProject);

    expect(freshState.runId).not.toBe(firstState.runId);
    expect(freshState.stages['01-requirement-analyzer'].status).toBe('PENDING');
    expect(freshState.stages['01-requirement-analyzer'].output).toBeNull();
    expect(freshState.stages['01-requirement-analyzer'].attempts).toBe(0);
    expect(freshState.errors).toEqual([]);
    expect(freshState.warnings).toEqual([]);

    const current = await stateManager.getFullState();
    expect(current.runId).toBe(freshState.runId);
    expect(current.stages['01-requirement-analyzer'].status).toBe('PENDING');
  });
});
