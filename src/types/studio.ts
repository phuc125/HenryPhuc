export interface BotProjectFile {
  path: string;
  name: string;
  sizeBytes: number;
  lines: number;
  content: string;
}

export interface BotProjectTree {
  projectName: string;
  fileCount: number;
  totalBytes: number;
  totalLines: number;
  files: BotProjectFile[];
}
