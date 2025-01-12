#!/usr/bin/env bun

import { AutomergeUrl, Repo } from "@automerge/automerge-repo"
import { BrowserWebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket"
import type { ImportedFile, Folder, FolderItem } from './types';
import { Command, createArgument } from 'commander';
import ora from 'ora';
import path from 'path';
import { mkdir, readdir, stat, copyFile, readFile } from 'fs/promises';
import { cosmiconfig } from 'cosmiconfig';
import ignore, { Ignore } from 'ignore';
import type { Stats } from 'fs';
import isBinaryPath from 'is-binary-path';
import mime from "mime-types";

const repo = new Repo({
  network: [
    new BrowserWebSocketClientAdapter("wss://sync.automerge.org")
  ]
});

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

// Global ignore patterns
let ig: Ignore;

const initIgnorePatterns = async (ignoreFile = '.gitignore'): Promise<void> => {
  ig = ignore();

  // Default patterns
  ig.add(['node_modules', '.git', '.DS_Store']);

  try {
    const patterns = await readFile(ignoreFile, 'utf8');
    ig.add(patterns);
  } catch (err) {
    // If ignore file doesn't exist, just use defaults
    if (err.code !== 'ENOENT') {
      console.warn(`Warning: Error reading ignore file: ${err.message}`);
    }
  }
};

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

async function createAutomergeDocuments(startPath: string) {
  // Create the root folder handle that will accumulate all documents
  const folderHandle = repo.create<Folder>({
    name: path.basename(startPath),
    contentType: "application/vnd.automerge.folder",
    contents: []
  })

  async function dfs(currentPath: string, parentHandle = folderHandle) {
    const stats = await stat(currentPath)

    const relativePath = path.relative(startPath, currentPath)
    // Skip if path matches gitignore rules
    if (relativePath && ig.ignores(relativePath)) {
      console.log("ignoring: " + currentPath)
      return parentHandle
    }

    console.log("recursing: " + currentPath)

    if (stats.isFile()) {
      const fileHandle = repo.create<ImportedFile>()

      const isBinary = isBinaryPath(currentPath);
      const buffer = await readFile(currentPath);
      const mimeType = mime.lookup(currentPath);
      

      console.log({ currentPath, mimeType, isBinary })

      if (isBinary) {
        fileHandle.change(d => {
          d.contents = Uint8Array.from(buffer)
          d.contentType = mimeType || "application/octet-stream"
          d.name = path.basename(currentPath)
          d.executable = !!(stats.mode & 0o111)
        })
      } else {
        const contents = await readFile(currentPath, 'utf-8')
        fileHandle.change(d => {
          d.contents = contents
          d.contentType = mimeType || "text/plain"
          d.name = path.basename(currentPath)
          d.executable = !!(stats.mode & 0o111)
        })
      }

      parentHandle.change(d => {
        d.contents.push({
          name: path.basename(currentPath),
          automergeUrl: fileHandle.url
        })
      })

      return parentHandle
    }

    if (stats.isDirectory()) {
      const dirHandle = repo.create<Folder>({
        name: path.basename(currentPath),
        contentType: "application/vnd.automerge.folder",
        contents: []
      })

      const children = await readdir(currentPath)

      for (const child of children) {
        await dfs(path.join(currentPath, child), dirHandle)
      }

      parentHandle.change(d => {
        d.contents.push({
          name: path.basename(currentPath),
          automergeUrl: dirHandle.url
        })
      })

      return parentHandle
    }
  }

  await dfs(startPath)
  return folderHandle
}

async function* walk(dir: string, root = dir): AsyncGenerator<FileInfo> {
  const files = await readdir(dir);

  for (const file of files) {
    const filepath = path.join(dir, file);
    const relativePath = path.relative(root, filepath);

    // Skip if file matches ignore patterns
    if (ig.ignores(relativePath)) {
      continue;
    }

    const stats = await stat(filepath);

    if (stats.isDirectory()) {
      yield* walk(filepath, root);
    } else {
      yield {
        path: filepath,
        relativePath,
        stats
      };
    }
  }
}

const processFile = async (fileInfo: FileInfo, destDir: string): Promise<string> => {
  const destPath = path.join(destDir, fileInfo.relativePath);
  console.log({ destPath, fileInfo })
  // await mkdir(path.dirname(destPath), { recursive: true });
  // await copyFile(fileInfo.path, destPath);
  return destPath;
};

const push = async (source: string, options: CommandOptions): Promise<void> => {
  const spinner = ora('Pushing files...').start();
  const config = await loadConfig();
  const destination = options.dest ?? config.defaultDestination ?? './dest';
  let fileCount = 0;

  try {
    await mkdir(destination, { recursive: true });

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
    await mkdir(destination, { recursive: true });

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
    const folderHandle = await createAutomergeDocuments(source)
    console.log(folderHandle.url)
    repo.shutdown()
  } catch (err) {
    console.error('List failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
};

const program = new Command();

// Global ignore file option
program
  .name('filesync')
  .description('CLI to sync files between directories')
  .version('0.1.0')
  .option('-i, --ignore <path>', 'Path to ignore file (defaults to .gitignore)');

// Initialize ignore patterns before running commands
program.hook('preAction', async () => {
  await initIgnorePatterns(program.opts().ignore);
});

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
