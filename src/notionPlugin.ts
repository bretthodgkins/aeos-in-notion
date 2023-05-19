import { 
  AeosPlugin,
  Command,
  CommandResult,
  CommandType,
  store,
  logger,
} from '@bhodgk/aeos'

import notionClient from './notionClient';

export class NotionPlugin implements AeosPlugin {
  name = 'Notion';
  description = 'Update Notion pages and comments from Aeos';
  version = '0.0.1';


  private commands: Command[];
  private isEnabled = false;
  private databaseId: string = '';

  constructor() {
    if (!process.env.NOTION_DATABASE_ID) {
      logger.log('Missing NOTION_DATABASE_ID env var - notion plugin not imported');
      this.commands = [];
      return;
    }

    this.databaseId = process.env.NOTION_DATABASE_ID;

    this.commands = [
      {
        "format": "notion:add page called ${title}",
        "type": CommandType.Function,
        "function": async (args: Record<string, string>) => await this.addPage(args),
        "requiresExactMatch": false,
      },
      {
        "format": "notion:rename page ${id} to ${title}",
        "type": CommandType.Function,
        "function": async (args: Record<string, string>) => await this.renamePage(args),
        "requiresExactMatch": false,
      },
      {
        "format": "notion:update status of page ${id} to ${status}",
        "type": CommandType.Function,
        "function": async (args: Record<string, string>) => await this.updatePageStatus(args),
        "requiresExactMatch": false,
      },
      {
        "format": "notion:comment ${comment} on page ${id}",
        "type": CommandType.Function,
        "function": async (args: Record<string, string>) => await this.commentOnPage(args),
        "requiresExactMatch": false,
      },
      {
        "format": "notion:delete page with id ${id}",
        "type": CommandType.Function,
        "function": async (args: Record<string, string>) => await this.deletePage(args),
        "requiresExactMatch": true, // prevent accidental deletion
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

  // notion:add page called ${title}
  async addPage(args: Record<string, string>): Promise<CommandResult> {
    if (!args.title) {
      return {
        success: false,
        message: 'Page title not provided',
      }
    }

    let icon = '📝';
    if (args.icon) {
      icon = Array.from(args.icon).slice(0, 5)[0]; // ensure that the icon is a single emoji
    }

    const id = await notionClient.addPageToDatabase(this.databaseId, args.title, icon);
    const success = typeof id === "string"; // return true if id is defined
    if (success) {
      store.addKeyValueToStore('lastNotionPageId', id);
    }
    return {
      success,
      message: success ? `Task created: https://www.notion.so/${id}` : 'Failed to create task',
    }
  }

  // notion:rename page ${id} to ${title}
  async renamePage(args: Record<string, string>): Promise<CommandResult> {
    if (!args.id) {
      return {
        success: false,
        message: 'id not provided',
      }
    }

    if (!args.title) {
      return {
        success: false,
        message: 'title not provided',
      }
    }

    return notionClient.renamePage(args.id, args.title);
  }

  // notion:update status of page ${id} to ${status}
  async updatePageStatus(args: Record<string, string>): Promise<CommandResult> {
    if (!args.id) {
      return {
        success: false,
        message: 'id not provided',
      };
    }
    if (!args.status) {
      return {
        success: false,
        message: 'status not provided',
      };
    }

    return notionClient.updatePageStatus(args.id, args.status);
  }

  // notion:comment ${comment} on page ${id}
  async commentOnPage(args: Record<string, string>): Promise<CommandResult> {
    if (!args.id) {
      return {
        success: false,
        message: 'id not provided',
      };
    }

    if (!args.comment) {
      return {
        success: false,
        message: 'comment not provided',
      };
    }

    return notionClient.commentOnPage(args.id, args.comment);
  }

  // notion:delete page with id ${id}
  async deletePage(args: Record<string, string>): Promise<CommandResult> {
    if (!args.id) {
      return {
        success: false,
        message: 'id not provided',
      };
    }

    return notionClient.deletePage(args.id);
  }

}
export default new NotionPlugin();