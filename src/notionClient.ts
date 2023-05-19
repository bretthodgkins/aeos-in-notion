import { Client } from '@notionhq/client';
import Bottleneck from "bottleneck"; // throttle requests to Notion API

import { 
  CommandResult,
  logger,
} from '@bhodgk/aeos'

export class NotionClient {
  private notionClient: any;

  private limiter = new Bottleneck({
    maxConcurrent: 1,
    minTime: 500,
  });

  constructor() {
    if (!process.env.NOTION_API_KEY) {
      logger.log('Missing NOTION_API_KEY env var - notion package not imported');
      return;
    }

    this.notionClient = new Client({ auth: process.env.NOTION_API_KEY })
  }

  getClient(): any {
    return this.notionClient;
  }

  getLimiter(): Bottleneck {
    return this.limiter;
  }

  async addPageToDatabase(databaseId: string, title: string, icon = '', children: any = [], assignName = ''): Promise<string | undefined> {
    let assign: any;
    if (assignName !== '') {
      assign = {
        select: {
          name: assignName,
        }
      }
    }

    try {
      const response = await this.limiter.schedule(() => this.notionClient.pages.create({
        parent: {
          database_id: databaseId,
        },
        icon: {
          "type": "emoji",
          "emoji": icon,
        },
        properties: {
          title: {
            title:[
              {
                text: {
                  content: title,
                }
              }
            ]
          },
          "Assign": assign,
        },
        children,
      })) as any;

      logger.log(`Page created with ID: ${response.id}`);
      return response.id;
    } catch (error: any) {
      logger.log(error.toString());
      return;
    }
  }

  async appendToBlock(id: string, children: any): Promise<string | undefined> {
    try {
      const response = await this.limiter.schedule(() => this.notionClient.blocks.children.append({
        block_id: id,
        children,
      })) as any;

      if (response?.results?.length) {
        const firstChildId = response.results[0].id;
        return firstChildId;
      } else {
        logger.log(`Unexpected result: ${JSON.stringify(response)}`);
        return;
      }
    } catch (error: any) {
      logger.log(error.toString());
      return;
    }
  }

  async renamePage(pageId: string, title: string): Promise<CommandResult> {
    try {
      await this.limiter.schedule(() => this.notionClient.pages.update({
        page_id: pageId,
        properties: {
          title: {
            title:[
              {
                text: {
                  content: title,
                }
              }
            ]
          }
        },
      })) as any;
      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        message: error.toString(),
      }
    }
  }

  // update status of page ${id} to ${status}
  async updatePageStatus(pageId: string, status: string): Promise<CommandResult> {
    try {
      await this.limiter.schedule(() => this.notionClient.pages.update({
        page_id: pageId,
        properties: {
          'Status': {
            'status': {
              name: status,
            }
          }
        },
      })) as any;

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        message: error.toString(),
      };
    }
  }

  async commentOnPage(pageId: string, comment: string): Promise<CommandResult> {
    try {
      await this.limiter.schedule(() => this.notionClient.comments.create({
        parent: {
          page_id: pageId,
        },
        "rich_text": [
          {
            "text": {
              "content": comment,
            }
          }
        ],
      })) as any;

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        message: error.toString(),
      };
    }
  }

  async deletePage(pageId: string): Promise<CommandResult> {
    try {
      await this.limiter.schedule(() => this.notionClient.pages.update({
        page_id: pageId,
        archived: true,
      })) as any;

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        message: error.toString(),
      };
    }
  }

  async findPageByTitle(databaseId: string, title: string): Promise<string | undefined> {
    const response = await this.limiter.schedule(() => this.notionClient.databases.query({
      database_id: databaseId,
      filter: {
        property: 'Name',
        title: {
          equals: title,
        }
      },
      page_size: 1,
    })) as any;

    const commands = response.results.filter((result: any) => {
      return result.parent?.type === 'database_id' && result.parent?.database_id?.replaceAll('-', '') === databaseId;
    });

    if (!commands.length) {
      return;
    }

    return commands[0].id;
  }
}

export default new NotionClient();