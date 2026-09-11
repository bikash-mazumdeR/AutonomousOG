import chalk from 'chalk';
import { stateManager } from '../core/state-manager/StateManager';
import { FRAMEWORK_CONFIG, PIPELINE_STAGES } from '../config/framework.config';

require('ts-node').register({ transpileOnly: true });

/**
 *
 */
async function showStatus() {
  await stateManager.initialize(FRAMEWORK_CONFIG.projectId);

  const render = async () => {
    const state = await stateManager.getFullState();

    if (process.argv.includes('--watch')) {
      process.stdout.write('\x1Bc'); // Clear screen
    }

    console.log(chalk.cyan.bold('\n📊 ARIA PIPELINE VISUALIZER'));
    console.log(chalk.gray(`Project: ${state.projectId} | Run ID: ${state.runId}`));
    console.log(chalk.gray(`Started At: ${state.startedAt}\n`));

    const statusIcons = {
      PENDING: chalk.gray('○'),
      RUNNING: chalk.yellow('▶'),
      COMPLETED: chalk.green('✔'),
      APPROVED: chalk.green('✅'),
      REJECTED: chalk.red('❌'),
      FAILED: chalk.red('✘'),
      SKIPPED: chalk.gray('⊘'),
      AWAITING: chalk.magenta('⌛'),
    };

    PIPELINE_STAGES.forEach((stage, index) => {
      const stageState = state.stages[stage.id] || { status: 'PENDING' };
      const icon = statusIcons[stageState.status] || ' ';
      const padding = ' '.repeat(Math.max(0, 30 - stage.name.length));

      const line = `${chalk.gray(String(index + 1).padStart(2, '0'))} ${icon} ${chalk.white(stage.name)}${padding}`;

      const barWidth = 20;
      let bar = '';
      if (stageState.status === 'COMPLETED' || stageState.status === 'APPROVED') {
        bar = chalk.green('█'.repeat(barWidth));
      } else if (stageState.status === 'RUNNING') {
        const pulse = Math.floor((Date.now() / 500) % 5);
        bar = chalk.yellow('█'.repeat(pulse * 4) + '░'.repeat(barWidth - pulse * 4));
      } else {
        bar = chalk.gray('░'.repeat(barWidth));
      }

      console.log(`${line} [${bar}] ${chalk.bold(stageState.status)}`);
    });

    if (state.errors.length > 0) {
      console.log(chalk.red.bold('\n❌ ERRORS DETECTED:'));
      state.errors.slice(-3).forEach((err) => console.log(chalk.red(`  - ${err.message || err}`)));
    }
  };

  await render();

  if (process.argv.includes('--watch')) {
    console.log(chalk.blue('\n👀 Watching for changes (Ctrl+C to exit)...'));
    setInterval(render, 2000);
  } else {
    console.log('\n');
  }
}

showStatus().catch(console.error);
