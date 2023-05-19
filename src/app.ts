#!/usr/bin/env node
require('dotenv').config()

import { Command } from 'commander';

import { 
  CommandResult,
  runCommands,
  store,
  logger,
  notifications,
} from '@bhodgk/aeos'

import notionClient from './notionClient';
import { AeosInNotionPlugin } from './aeosInNotionPlugin';

const limiter = notionClient.getLimiter();
let isRunning = false;

let aeosInNotionPlugin: AeosInNotionPlugin;

let aeosName = process.env.AEOS_IN_NOTION_NAME ?? 'aeos';
let databaseIdCommands = process.env.AEOS_IN_NOTION_COMMANDS_DB ?? '';
let databaseIdTasks = process.env.AEOS_IN_NOTION_TASKS_DB ?? '';

let lastEditedTime: string = ''; // used for getting latest updates
let currentTaskId: string = '';

let main = async () => {
  const program = new Command();

  program
    .version('1.0.0')
    .option('-t, --tasksDB <tasksDB>', 'Notion Database ID for your task board')
    .option('-c, --commandsDB <commandsDB>', 'Notion Database ID to populate available commands')
    .option('-n, --name <name>', 'name agents to assign tasks to specific instances')
    .option('-d, --debug', 'enable debug console logs')
    .option('-l, --log', 'enable debug logging to file')
    .parse(process.argv);

  const options = program.opts();

  if (options.name) aeosName = options.name;
  if (options.tasksDB) databaseIdTasks = options.tasksDB;
  if (options.commandsDB) databaseIdCommands = options.commandsDB;

  if (program.opts().debug) {
    store.addKeyValueToStore('enableLogToConsole', 'true');
  }

  if (program.opts().log) {
    store.addKeyValueToStore('enableLogToFile', 'true');
  }

  aeosInNotionPlugin = new AeosInNotionPlugin(databaseIdCommands, databaseIdTasks, aeosName);

  notifications.registerHandler({
    name: 'aeos-in-notion',
    handler: commentOnCurrentTask,
  });

  setTimeout(() => {
    pollLatestUpdates();
  }, 10000);
}

async function pollLatestUpdates() {
  await getLatestUpdates();
  setTimeout(async () => {
    await pollLatestUpdates();
  }, 1000);
}

  async function getLatestUpdates() {
  if (isRunning) {
    return;
  }

  const response = await limiter.schedule(() => notionClient.getClient().databases.query({
    database_id: databaseIdTasks,
    filter: {
      "and": [
        {
          property: 'Assign',
          select: {
            equals: aeosName,
          },
        },
        {
          property: 'Status',
          status: {
            equals: 'Queued',
          },
        },
      ],
    },
    sort: {
      direction: 'descending',
      timestamp: 'last_edited_time',
    },
    page_size: 10,
  })) as any;

  const tasks = response.results;

  if (!tasks.length) {
    return;
  }

  const firstQueuedTask = tasks[0];
  const nextTaskLastEditedTime = firstQueuedTask.last_edited_time;
    notionClient.updatePageStatus(firstQueuedTask.id, 'Running');
    await runTask(firstQueuedTask);
  if (response.results.length && response.results[0].last_edited_time) {
    lastEditedTime = response.results[0].last_edited_time;
  }
}

async function runTask(task: any) {
  currentTaskId = task.id;

  // get all todos
  const response = await limiter.schedule(() => notionClient.getClient().blocks.children.list({
    block_id: task.id,
    page_size: 100,
  })) as any;
  const todos = response.results.filter((result: any) => {
    return result.type === 'to_do';
  });

  let finalResult = { success: true } as CommandResult;

  for (const todo of todos) {
    if (todo.to_do.checked) {
      continue;
    }

    const command = todo.to_do.rich_text[0].text.content.replaceAll('“', '"').replaceAll('”', '"');
    finalResult = await runCommands([command]);
    isRunning = false;

    if (finalResult.success) {
      logger.log(`Aeos In Notion: Command "${command}" resolved successfully`);
      await limiter.schedule(() => notionClient.getClient().blocks.update({
        block_id: todo.id,
        to_do: {
          checked: true,
        },
      })) as any;
    } else {
      // leave a comment on the task
      logger.log(`Aeos In Notion: Command "${command}" failed.`);
      await notionClient.updatePageStatus(task.id, 'Issue');
      await notionClient.commentOnPage(task.id, `Failed to complete the following command:\n${command}\n\n${finalResult.message}`);
      break;
    }
  }

  if (finalResult.success) {
      await notionClient.updatePageStatus(task.id, 'Done');
      if (finalResult.message && finalResult.message.length) {
        await notionClient.commentOnPage(task.id, finalResult.message);
      }
      await notionClient.commentOnPage(task.id, 'Task completed successfully');
  }
}

async function commentOnCurrentTask(title: string, body: string) {
  if (!currentTaskId || currentTaskId === '') {
    return false;
  }
  await notionClient.commentOnPage(currentTaskId, `${title}: ${body}`);
}

main();