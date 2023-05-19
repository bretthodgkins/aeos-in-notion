export type NotionDatabase = {
  id: string;
  title: string;
  description: string;
  properties: Record<string, any>;
}

export type NotionPage = {
  id: string;
  properties: Record<string, any>;
}
