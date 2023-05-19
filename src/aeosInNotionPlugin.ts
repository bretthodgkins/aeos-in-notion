import { 
  AeosPlugin,
  Command,
  CommandResult,
  CommandType,
  getAllCommandFormats,
  getCommandFromFormat,
  getCommandExecutablesFromCommandInput,
  getCommandInputString,
  textCompletion,
} from '@bhodgk/aeos'

import notionClient from './notionClient';

import {
  convertCommandInputsToBulletedList,
  createBlockBulletedListItem,
  createBlockHeading,
  createBlockParagraph,
  createBlockTask,
} from './util';

export class AeosInNotionPlugin implements AeosPlugin {
  name = 'aeos-in-notion';
  description = 'Aeos In Notion - Schedule and monitor an army of aeos agents in Notion';
  version = '0.0.1';

  private commands: Command[];
  private isEnabled = false;

  private databaseIdCommands: string = '';
  private databaseIdTasks: string = '';

  // Used for assigning tasks to different instances
  // Is set by 'aeosName' in config.json5
  private aeosName: string = '';

  constructor(databaseIdCommands: string, databaseIdTasks: string, aeosName: string) {
    this.databaseIdCommands = databaseIdCommands;
    this.databaseIdTasks = databaseIdTasks;
    this.aeosName = aeosName;

    this.commands = [
      {
        "format": "aeos-in-notion:create task to ${prompt}",
        "type": CommandType.Function,
        "function": async (args: Record<string, string>) => await this.createTaskFromPrompt(args),
        "requiresExactMatch": false,
      },
      {
        "format": "aeos-in-notion:create task with ${title} ${description} ${tasks}",
        "type": CommandType.Function,
        "function": async (args: Record<string, string>) => await this.createTask(args),
        "requiresExactMatch": false,
      },
      {
        "format": "aeos-in-notion:import command ${command}",
        "type": CommandType.Function,
        "function": async (args: Record<string, string>) => await this.importCommand(args),
        "requiresExactMatch": false,
      },
      {
        "format": "aeos-in-notion:import all commands",
        "type": CommandType.Function,
        "function": async (args: Record<string, string>) => await this.importAllCommands(args),
        "requiresExactMatch": false,
      },
    ];

    this.isEnabled = true;
  }

  getCommands(): Command[] {
    return this.commands;
  }

  getIsEnabled(): boolean {
    return this.isEnabled;
  }

  // aeos-in-notion:create task to ${prompt}
  async createTaskFromPrompt(args: Record<string, string>): Promise<CommandResult> {
    if (!args.prompt) {
      return {
        success: false,
        message: 'No prompt provided',
      }
    }

    const title = (await textCompletion.generateText(`Provide a very short title for the task: ${args.prompt}`, 20, 0.2)).trim();
    const iconResponse = await (await textCompletion.generateText(`Provide a single emoji for the task: ${title}`, 10, 0.5));
    let icon = Array.from(iconResponse.trim()).slice(0, 5)[0]; // ensure that the icon is a single emoji
    const description = (await textCompletion.generateText(`Provide a 1-2 sentence description for the task: ${args.prompt}`, 40, 0.4)).trim();

    return this.createTask({
      title,
      icon,
      description,
      tasks: args.prompt,
    });
  }

  // aeos-in-notion:create task with ${title} ${description} ${tasks} ${icon}
  async createTask(args: Record<string, string>): Promise<CommandResult> {
    if (!args.title) {
      return {
        success: false,
        message: 'No title provided',
      }
    }

    if (!args.description) {
      return {
        success: false,
        message: 'No description provided',
      }
    }

    if (!args.tasks) {
      return {
        success: false,
        message: 'No tasks provided',
      }
    }

    const title = args.title;
    let icon = args.icon ?? '📝';
    const description = args.description.replace(/\\n/g, '\n');

    let children = [
      createBlockHeading('Description'),
      createBlockParagraph(description),
    ];

    children.push(createBlockHeading('Task List'));
    let pageId  = '' as string | undefined;
    try {
      const commandExecutables = await getCommandExecutablesFromCommandInput(args.tasks, true);
      for (const commandExecutable of commandExecutables) {
        const rawId = await notionClient.findPageByTitle(this.databaseIdCommands, commandExecutable.command.format);
        const id = rawId ? rawId.replace(/-/g, '') : undefined;
        const url = id ? `https://www.notion.so/${id}` : undefined;
        children.push(createBlockTask(getCommandInputString(commandExecutable.commandInput), url));
      }
      pageId = await notionClient.addPageToDatabase(this.databaseIdTasks, title, icon, children, this.aeosName);
    } catch(e) {
      children.push(createBlockTask('', undefined));
      pageId = await notionClient.addPageToDatabase(this.databaseIdTasks, title, icon, children, this.aeosName);
      if (!pageId) {
        return {
          success: false,
          message: 'Failed to create task',
        };
      }
      await notionClient.commentOnPage(pageId, `Wasn't sure what tasks to list for this one!`);
    }

    const success = typeof pageId === "string"; // return true if id is defined
    return {
      success,
      message: success ? `Task created: https://www.notion.so/${pageId}` : 'Failed to create task',
    }
  }

  // aeos-in-notion:import command ${command}
  async importCommand(args: Record<string, string>): Promise<CommandResult> {
    if (!args.command) {
      return {
        success: false,
        message: 'No command provided',
      };
    }

    const command = getCommandFromFormat(args.command);
    if (!command) {
      return {
        success: false,
        message: `Command not found: ${args.command}`,
      };
    }

    // first, create the page without the task list
    let children = [];
    children.push(createBlockHeading('Description'));
    if (command.description) {
      children.push(createBlockParagraph(command.description));
    } else {
      children.push(createBlockParagraph('No description provided for this command'));
    }

    children.push(createBlockHeading('Requirements'));
    if (command.requiresApplication) {
      children.push(createBlockBulletedListItem(command.requiresApplication));
    } else {
      children.push(createBlockBulletedListItem('No requirements to run this command'));
    }

    if (command.sequence) {
      children.push(createBlockHeading('Actions'));
      // action blocks will be added later to handle nested children
    } else {
      children.push(createBlockHeading('Actions'));
      children.push(createBlockBulletedListItem('This is an in-built command'));
    }

    const pageId = await notionClient.addPageToDatabase(this.databaseIdCommands, command.format, '🧑‍💻', children);
    if (typeof pageId !== "string") {
      return {
        success: false,
        message: `Failed to create page for command: ${command.format}`,
      };
    }

    // Second, add each nested child one at a time
    if (command.sequence) {
      const actions = convertCommandInputsToBulletedList(command.sequence);
      for (const action of actions) {
        const appendToBlock = async (blockId: string, block: any) => {
          if (block.bulleted_list_item?.children) {
            const children = block.bulleted_list_item.children;
            const blockNoChildren = {
              ...block,
              bulleted_list_item: {
                ...block.bulleted_list_item,
                children: [],
              }
            };
            const newBlockId = await notionClient.appendToBlock(blockId, [ blockNoChildren ]);
            if (!newBlockId) return false;

            for (const child of children) {
              const result = await appendToBlock(newBlockId, child);
              if (!result) return false; 
            }
          } else {
            const newBlockId = await notionClient.appendToBlock(blockId, [ block ]);
            if (!newBlockId) return false;
          }
          return true;
        };
        await appendToBlock(pageId, action);
      }
    }

    return { success: true } as CommandResult;
  }

  async importAllCommands(args: Record<string, string>): Promise<CommandResult> {
    const commands = getAllCommandFormats();
    for (const command of commands) {
      const result = await this.importCommand({ command });
      if (!result) {
        return {
          success: false,
          message: `Failed to import command: ${command}`,
        }
      }
    }
    return { success: true } as CommandResult;
  }

}
export default AeosInNotionPlugin;