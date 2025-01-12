#!/usr/bin/env bun
import { Repo } from "@automerge/automerge-repo"

import { Command } from 'commander';
import ora from 'ora';
import path from 'path';
import { mkdir, readdir, stat, copyFile } from 'fs/promises';
import { cosmiconfig } from 'cosmiconfig';
import type { Stats } from 'fs';

interface FileInfo {
  path: string;
  relativePath: string;
  stats: Stats;
}

interface Config {
  defaultDestination?: string;
  defaultSource?: string;
}

interface CommandOptions {
  dest?: string;
}

// Configuration explorer
const explorer = cosmiconfig('filesync');

const loadConfig = async (): Promise<Config> => {
  try {
    const result = await explorer.search();
    return result?.config ?? {};
  } catch (err) {
    console.error('Error loading config:', err instanceof Error ? err.message : err);
    return {};
  }
};

async function* walk(dir: string): AsyncGenerator<FileInfo> {
  const files = await readdir(dir);
  
  for (const file of files) {
    const filepath = path.join(dir, file);
    const stats = await stat(filepath);
    
    if (stats.isDirectory()) {
      yield* walk(filepath);
    } else {
      yield {
        path: filepath,
        relativePath: path.relative(dir, filepath),
        stats
      };
    }
  }
}

const processFile = async (fileInfo: FileInfo, destDir: string): Promise<string> => {
  // This is where you can add custom processing for each file
  // Currently just copying, but you could transform content here
  const destPath = path.join(destDir, fileInfo.relativePath);
  await mkdir(path.dirname(destPath), { recursive: true });
  console.log(`Copying ${fileInfo.path} to ${destPath}`);
  // await copyFile(fileInfo.path, destPath);
  return destPath;
};

const push = async (source: string, options: CommandOptions): Promise<void> => {
  const spinner = ora('Pushing files...').start();
  const config = await loadConfig();
  const destination = options.dest ?? config.defaultDestination ?? './dest';
  let fileCount = 0;

  try {
    // Ensure destination exists
    await mkdir(destination, { recursive: true });

    // Walk through all files recursively
    for await (const fileInfo of walk(source)) {
      spinner.text = `Processing: ${fileInfo.relativePath}`;
      
      await processFile(fileInfo, destination);
      fileCount++;
    }

    spinner.succeed(`Successfully pushed ${fileCount} files to ${destination}`);
  } catch (err) {
    spinner.fail(`Push failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
};

const pull = async (source: string, options: CommandOptions): Promise<void> => {
  const spinner = ora('Pulling files...').start();
  const config = await loadConfig();
  const destination = options.dest ?? config.defaultSource ?? './src';
  let fileCount = 0;

  try {
    // Ensure destination exists
    await mkdir(destination, { recursive: true });

    // Walk through all files recursively
    for await (const fileInfo of walk(source)) {
      spinner.text = `Processing: ${fileInfo.relativePath}`;
      
      await processFile(fileInfo, destination);
      fileCount++;
    }

    spinner.succeed(`Successfully pulled ${fileCount} files to ${destination}`);
  } catch (err) {
    spinner.fail(`Pull failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
};

const list = async (source: string): Promise<void> => {
  console.log(`Listing all files in ${source}:`);
  
  try {
    for await (const fileInfo of walk(source)) {
      console.log(`- ${fileInfo.relativePath}`);
      console.log(`  Size: ${fileInfo.stats.size} bytes`);
      console.log(`  Modified: ${fileInfo.stats.mtime}`);
    }
  } catch (err) {
    console.error('List failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
};

const program = new Command();

program
  .name('filesync')
  .description('CLI to sync files between directories')
  .version('0.1.0');

program.command('push')
  .description('Push files to destination')
  .argument('<source>', 'Source directory')
  .option('-d, --dest <path>', 'Destination directory')
  .action(push);

program.command('pull')
  .description('Pull files from source')
  .argument('<source>', 'Source directory')
  .option('-d, --dest <path>', 'Destination directory')
  .action(pull);

program.command('list')
  .description('List all files in directory')
  .argument('<source>', 'Source directory')
  .action(list);

program.parse();