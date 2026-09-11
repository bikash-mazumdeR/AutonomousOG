import chalk from 'chalk';
import { memoryEngine } from '../core/project-memory/MemoryEngine';
import { FRAMEWORK_CONFIG } from '../config/framework.config';

require('ts-node').register({ transpileOnly: true });

/**
 *
 */
async function showMemory() {
  await memoryEngine.initialize(FRAMEWORK_CONFIG.projectId);
  const memory = await memoryEngine.getFullMemory();

  console.log(chalk.magenta.bold('\n🧠 ARIA PROJECT MEMORY'));
  console.log(chalk.gray(`Updated At: ${memory.updatedAt}\n`));

  console.log(chalk.white.bold('1. Performance Metrics:'));
  console.log(`   - Total Runs:      ${memory.metrics.totalRuns}`);
  console.log(`   - Tests Executed:  ${memory.metrics.totalTestsRun}`);
  console.log(`   - Avg Pass Rate:   ${memory.metrics.avgPassRate}%`);
  console.log(`   - Bugs Found:      ${memory.metrics.totalBugsFound}`);
  console.log(`   - Auto Heals:      ${memory.metrics.totalAutoHeals}`);

  console.log(chalk.white.bold('\n2. Healed Selectors:'));
  const selectors = Object.keys(memory.globalLearnings.selectorPatterns);
  if (selectors.length === 0) console.log(chalk.gray('   No patterns discovered yet.'));
  selectors.slice(0, 5).forEach((s) => {
    const p = memory.globalLearnings.selectorPatterns[s];
    console.log(`   - ${chalk.yellow(p.brokenSelector)} → ${chalk.green(p.workingSelector)} (Success: ${p.successCount})`);
  });

  console.log(chalk.white.bold('\n3. Known Bugs:'));
  if (memory.globalLearnings.knownBugs.length === 0) console.log(chalk.gray('   No bugs tracked yet.'));
  memory.globalLearnings.knownBugs.slice(0, 3).forEach((bug) => {
    console.log(`   - [${bug.severity}] ${bug.title} (${bug.jiraKey || 'No Jira'})`);
  });

  console.log('\n');
}

showMemory().catch(console.error);
