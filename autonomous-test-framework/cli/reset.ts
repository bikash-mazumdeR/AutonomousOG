import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

/**
 *
 */
async function reset() {
  const dirs = [
    path.resolve(__dirname, '../.state'),
    path.resolve(__dirname, '../reports'),
  ];

  console.log(chalk.yellow('♻️ Resetting ARIA Pipeline State...'));

  dirs.forEach((dir) => {
    if (fs.existsSync(dir)) {
      console.log(chalk.gray(`  - Clearing ${dir}`));
      fs.rmSync(dir, { recursive: true, force: true });
    }
    fs.mkdirSync(dir, { recursive: true });
  });

  console.log(chalk.green('✅ Reset complete. Ready for a new run.\n'));
}

reset().catch(console.error);
