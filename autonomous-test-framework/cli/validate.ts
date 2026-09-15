import dotenv from 'dotenv';

import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

dotenv.config();

/**
 *
 */
async function validate() {
  console.log(chalk.cyan.bold('\n🔍 ARIA FRAMEWORK VALIDATION'));

  let errors = 0;

  console.log(chalk.white('\n1. Checking Environment Variables:'));
  if (!process.env.AUT_BASE_URL) {
    console.log(chalk.red('  [✖] AUT_BASE_URL is missing'));
    errors++;
  } else {
    console.log(chalk.green(`  [✔] AUT_BASE_URL is present (${process.env.AUT_BASE_URL})`));
  }

  const hasLlmKey = Boolean(
    process.env.AWS_BEARER_TOKEN_BEDROCK
    || process.env.GEMINI_API_KEY
    || (process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.includes('xxxxxxxx'))
    || (process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY.includes('xxxxxxxx')),
  );

  if (!hasLlmKey) {
    console.log(chalk.red('  [✖] No valid LLM API key configured (AWS_BEARER_TOKEN_BEDROCK, GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY)'));
    errors++;
  } else {
    const activeProvider = ['AWS_BEARER_TOKEN_BEDROCK', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'].find((name) => process.env[name]);
    console.log(chalk.green(`  [✔] LLM API key is present (${activeProvider})`));
    if (process.env.AWS_BEARER_TOKEN_BEDROCK && (!process.env.AWS_REGION || !process.env.LLM_MODEL_DEFAULT)) {
      console.log(chalk.yellow('  [!] Bedrock key is set but AWS_REGION or LLM_MODEL_DEFAULT is missing (region defaults to us-east-1; agents without a model use the Gemini fallback)'));
    }
  }

  console.log(chalk.white('\n2. Checking Directory Structure:'));
  const dirs = ['agents', 'core', 'config', 'skills', 'tests'];
  dirs.forEach((dir) => {
    if (!fs.existsSync(path.resolve(__dirname, '..', dir))) {
      console.log(chalk.red(`  [✖] ${dir}/ directory is missing`));
      errors++;
    } else {
      console.log(chalk.green(`  [✔] ${dir}/ is present`));
    }
  });

  if (errors > 0) {
    console.log(chalk.red.bold(`\n❌ Validation failed with ${errors} issues.\n`));
    process.exit(1);
  } else {
    console.log(chalk.green.bold('\n✅ All checks passed! ARIA is ready.\n'));
  }
}

validate().catch(console.error);
