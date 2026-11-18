import axios from 'axios';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import JSZip from 'jszip';

const execFileAsync = promisify(execFile);

export const HOT_RELOAD_EXIT_CODE = 42;
const ROLLBACK_ROOT_NAME = '.rollback';
const HOT_UPDATES_DIR_NAME = 'hot_updates';
const ALLOWED_CODE_EXTENSIONS = new Set(['.ts', '.json']);

export interface IncomingBotFile {
  targetHint: string;
  content: Buffer | string;
}

export interface TsDiagnostic {
  file: string;
  line: number;
  col: number;
  code: string;
  message: string;
}

export interface RollbackManifest {
  createdAt: number;
  rollbackDir: string;
  overwrittenFiles: string[];
  createdFiles: string[];
}

export interface PendingRestartState {
  createdAt: number;
  rollbackDir: string;
  updatedFiles: string[];
  attempts: number;
  maxAttempts: number;
  autoFixLogs: string[];
}

export interface BootNotice {
  status: 'UPDATED' | 'AUTO_FIXED_RUNTIME' | 'ROLLED_BACK';
  message: string;
  updatedFiles: string[];
  timestamp: number;
}

export interface HotUpdateResult {
  success: boolean;
  compiled: boolean;
  autoFixed: boolean;
  rolledBack: boolean;
  updatedFiles: string[];
  autoFixLogs: string[];
  compilerOutput: string;
  error?: string;
}

export interface OpenAiRepairConfig {
  apiKey?: string;
  baseUrl?: string;
}

function listAllSrcFiles(srcDir: string, prefix = ''): string[] {
  if (!fs.existsSync(srcDir)) return [];
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(srcDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listAllSrcFiles(full, rel));
    } else if (entry.isFile()) {
      results.push(rel.replace(/\\/g, '/'));
    }
  }
  return results;
}

export function resolveSafeBotTarget(botRoot: string, hint: string): string | null {
  let clean = hint.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean || clean.includes('..') || clean.includes('\0')) return null;
  if (clean.startsWith('solana-ai-sniper-bot/')) {
    clean = clean.slice('solana-ai-sniper-bot/'.length);
  }

  const ext = path.extname(clean).toLowerCase();
  if (!ALLOWED_CODE_EXTENSIONS.has(ext)) return null;

  if (clean === 'tsconfig.json') {
    return 'tsconfig.json';
  }

  if (clean.startsWith('src/')) {
    const resolved = path.resolve(botRoot, clean);
    const srcRoot = path.resolve(botRoot, 'src');
    if (!resolved.startsWith(srcRoot + path.sep)) return null;
    return clean;
  }

  // Match by basename inside src/
  const baseName = path.basename(clean);
  const srcFiles = listAllSrcFiles(path.join(botRoot, 'src'));
  const exactMatches = srcFiles.filter((f) => path.basename(f) === baseName);
  if (exactMatches.length === 1) {
    return `src/${exactMatches[0]}`;
  }

  // Allow relative hint inside src without leading "src/"
  const directUnderSrc = srcFiles.find((f) => f === clean);
  if (directUnderSrc) {
    return `src/${directUnderSrc}`;
  }

  return `src/custom/${baseName}`;
}

export async function runTscCompile(
  botRoot: string,
  noEmit = false,
): Promise<{ ok: boolean; output: string; diagnostics: TsDiagnostic[] }> {
  const localTsc = path.join(
    botRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsc.cmd' : 'tsc',
  );
  const cmd = fs.existsSync(localTsc) ? localTsc : 'npx';
  const args = fs.existsSync(localTsc)
    ? ['-p', 'tsconfig.json', ...(noEmit ? ['--noEmit'] : [])]
    : ['tsc', '-p', 'tsconfig.json', ...(noEmit ? ['--noEmit'] : [])];

  try {
    const res = await execFileAsync(cmd, args, {
      cwd: botRoot,
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const combined = `${res.stdout ?? ''}\n${res.stderr ?? ''}`.trim();
    return { ok: true, output: combined || 'tsc compile succeeded (0 errors)', diagnostics: [] };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const rawOut = `${e.stdout ?? ''}\n${e.stderr ?? ''}\n${e.message ?? ''}`.trim();
    const diagnostics = parseTscDiagnostics(rawOut);
    return { ok: false, output: rawOut, diagnostics };
  }
}

export function parseTscDiagnostics(output: string): TsDiagnostic[] {
  const diagnostics: TsDiagnostic[] = [];
  const regex = /^([^\r\n(]+)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(output)) !== null) {
    diagnostics.push({
      file: match[1].trim().replace(/\\/g, '/'),
      line: Number(match[2]),
      col: Number(match[3]),
      code: match[4],
      message: match[5].trim(),
    });
  }
  return diagnostics;
}

function stripMarkdownFences(raw: string): { text: string; changed: boolean } {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)\r?\n```$/);
  if (fenceMatch) {
    return { text: `${fenceMatch[1]}\n`, changed: true };
  }
  return { text: raw, changed: false };
}

function computeRelativeModuleImport(fromRelFile: string, toRelFile: string): string {
  const fromDir = path.posix.dirname(fromRelFile);
  let rel = path.posix.relative(fromDir, toRelFile).replace(/\.ts$/, '');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

export function applyDeterministicTsFixes(
  botRoot: string,
  diagnostics: TsDiagnostic[],
  touchedFiles: string[],
): { fixedAny: boolean; logs: string[] } {
  const logs: string[] = [];
  let fixedAny = false;
  const allSrc = listAllSrcFiles(path.join(botRoot, 'src')).map((f) => `src/${f}`);

  const candidateFiles = new Set<string>([
    ...touchedFiles,
    ...diagnostics.map((d) => d.file),
  ]);

  for (const relOrAbs of candidateFiles) {
    const fullPath = path.isAbsolute(relOrAbs) ? relOrAbs : path.resolve(botRoot, relOrAbs);
    const relPath = path.relative(botRoot, fullPath).replace(/\\/g, '/');
    if (!fs.existsSync(fullPath) || !relPath.startsWith('src/')) continue;

    let content = fs.readFileSync(fullPath, 'utf-8');
    let fileChanged = false;

    // 1. Strip accidental Markdown code fences
    const stripped = stripMarkdownFences(content);
    if (stripped.changed) {
      content = stripped.text;
      fileChanged = true;
      logs.push(`[AutoFix] Đã gỡ Markdown code fence thừa trong ${relPath}`);
    }

    const fileDiags = diagnostics.filter(
      (d) => d.file.replace(/\\/g, '/') === relPath || path.resolve(botRoot, d.file) === fullPath,
    );

    for (const d of fileDiags) {
      // 2. Fix mistaken .ts suffix or wrong relative depth in TS2307/TS2835
      if (d.code === 'TS2307' || d.code === 'TS2835') {
        const modMatch = d.message.match(/Cannot find module '([^']+)'/);
        if (modMatch) {
          const badSpec = modMatch[1];
          if (badSpec.endsWith('.ts')) {
            const cleanedSpec = badSpec.replace(/\.ts$/, '');
            if (content.includes(badSpec)) {
              content = content.split(`'${badSpec}'`).join(`'${cleanedSpec}'`);
              content = content.split(`"${badSpec}"`).join(`"${cleanedSpec}"`);
              fileChanged = true;
              logs.push(`[AutoFix] Bỏ đuôi .ts trong import '${badSpec}' (${relPath})`);
            }
          } else if (badSpec.startsWith('.')) {
            const targetBase = `${path.posix.basename(badSpec).replace(/\.(js|ts)$/, '')}.ts`;
            const candidate = allSrc.find((s) => path.posix.basename(s) === targetBase);
            if (candidate) {
              const corrected = computeRelativeModuleImport(relPath, candidate);
              if (corrected !== badSpec && content.includes(badSpec)) {
                content = content.split(`'${badSpec}'`).join(`'${corrected}'`);
                content = content.split(`"${badSpec}"`).join(`"${corrected}"`);
                fileChanged = true;
                logs.push(`[AutoFix] Sửa đường dẫn import '${badSpec}' -> '${corrected}' (${relPath})`);
              }
            }
          }
        }
      }

      // 3. Fix TS6133 unused locals / parameters
      if (d.code === 'TS6133') {
        const unusedMatch = d.message.match(/^'([^']+)' is declared but its value is never read/);
        if (unusedMatch) {
          const ident = unusedMatch[1];
          const lines = content.split('\n');
          const idx = d.line - 1;
          if (lines[idx] !== undefined) {
            const lineText = lines[idx];
            if (/^\s*import\b/.test(lineText)) {
              // Remove unused named import item cleanly
              const singleNamed = new RegExp(`^\\s*import\\s+\\{\\s*${ident}\\s*\\}\\s+from\\s+[^;]+;?\\s*$`);
              if (singleNamed.test(lineText)) {
                lines[idx] = '';
                content = lines.join('\n');
                fileChanged = true;
                logs.push(`[AutoFix] Xóa import thừa '${ident}' dòng ${d.line} (${relPath})`);
              } else {
                const updatedLine = lineText
                  .replace(new RegExp(`\\b${ident}\\s*,\\s*`), '')
                  .replace(new RegExp(`,\\s*\\b${ident}\\b`), '');
                if (updatedLine !== lineText) {
                  lines[idx] = updatedLine;
                  content = lines.join('\n');
                  fileChanged = true;
                  logs.push(`[AutoFix] Gỡ symbol import thừa '${ident}' dòng ${d.line} (${relPath})`);
                }
              }
            } else if (/^\s*(?:const|let|var)\b/.test(lineText) && lineText.trim().endsWith(';')) {
              lines[idx] = `${lineText} void ${ident};`;
              content = lines.join('\n');
              fileChanged = true;
              logs.push(`[AutoFix] Khử lỗi noUnusedLocals bằng 'void ${ident};' dòng ${d.line} (${relPath})`);
            } else if (!ident.startsWith('_')) {
              const replacedLine = lineText.replace(new RegExp(`\\b${ident}\\b`), `_${ident}`);
              if (replacedLine !== lineText) {
                lines[idx] = replacedLine;
                content = lines.join('\n');
                fileChanged = true;
                logs.push(`[AutoFix] Đổi tham số không dùng '${ident}' -> '_${ident}' dòng ${d.line} (${relPath})`);
              }
            }
          }
        }
      }

      // 4. Add known missing standard imports (TS2304)
      if (d.code === 'TS2304') {
        const missingMatch = d.message.match(/^Cannot find name '([^']+)'/);
        if (missingMatch) {
          const name = missingMatch[1];
          const knownImports: Record<string, string> = {
            axios: "import axios from 'axios';",
            fs: "import fs from 'fs';",
            path: "import path from 'path';",
            PublicKey: "import { PublicKey } from '@solana/web3.js';",
          };
          const importStmt = knownImports[name];
          if (importStmt && !content.includes(importStmt)) {
            content = `${importStmt}\n${content}`;
            fileChanged = true;
            logs.push(`[AutoFix] Tự thêm import '${name}' vào đầu file ${relPath}`);
          }
        }
      }
    }

    if (fileChanged) {
      fs.writeFileSync(fullPath, content, 'utf-8');
      fixedAny = true;
    }
  }

  return { fixedAny, logs };
}

export async function attemptAiCodeRepair(
  botRoot: string,
  relFile: string,
  errorDetails: string,
  openAi?: OpenAiRepairConfig,
): Promise<{ repaired: boolean; log: string }> {
  const apiKey = openAi?.apiKey?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return { repaired: false, log: 'Bỏ qua AI Repair (chưa cấu hình OPENAI_API_KEY trong .env).' };
  }
  const fullPath = path.resolve(botRoot, relFile);
  if (!fs.existsSync(fullPath)) {
    return { repaired: false, log: `Không tìm thấy file ${relFile} để sửa.` };
  }

  const currentSource = fs.readFileSync(fullPath, 'utf-8');
  const baseUrl = (openAi?.baseUrl?.trim() || process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');

  try {
    const res = await axios.post<{
      choices?: Array<{ message?: { content?: string } }>;
    }>(
      `${baseUrl}/chat/completions`,
      {
        model: 'gpt-4o-mini',
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content:
              'You are a strict TypeScript compiler & Node.js runtime repair engine. Return ONLY the complete, fixed TypeScript source file with zero markdown fences and zero commentary.',
          },
          {
            role: 'user',
            content: `Fix this TypeScript file (${relFile}) so it compiles under strict TypeScript and runs without error.\n\nERROR DETAILS:\n${errorDetails.slice(
              0,
              3000,
            )}\n\nCURRENT SOURCE:\n${currentSource}`,
          },
        ],
      },
      {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 25_000,
      },
    );

    const rawContent = res.data?.choices?.[0]?.message?.content?.trim();
    if (!rawContent || rawContent.length < 20) {
      return { repaired: false, log: `AI Repair trả về rỗng cho ${relFile}.` };
    }
    const stripped = stripMarkdownFences(rawContent).text;
    fs.writeFileSync(fullPath, stripped, 'utf-8');
    return { repaired: true, log: `[AI AutoFix] Đã vá lỗi trong ${relFile} qua OpenAI.` };
  } catch (err) {
    return {
      repaired: false,
      log: `AI Repair lỗi kết nối: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function attemptRuntimeAutoFixAndRecompile(
  botRoot: string,
  runtimeErrorLog: string,
  pending: PendingRestartState,
  openAi?: OpenAiRepairConfig,
): Promise<{ fixed: boolean; logs: string[] }> {
  const logs: string[] = [];

  // Map any /dist/.../*.js stack frame back to src/.../*.ts
  const stackMatches = Array.from(
    runtimeErrorLog.matchAll(/[/\\]dist[/\\]([^\s:)]+\.js)(?::(\d+))?/g),
  );
  const candidateTargets = new Set<string>(pending.updatedFiles);
  for (const m of stackMatches) {
    const srcRel = `src/${m[1].replace(/\\/g, '/').replace(/\.js$/, '.ts')}`;
    if (fs.existsSync(path.resolve(botRoot, srcRel))) {
      candidateTargets.add(srcRel);
    }
  }

  const targetList = Array.from(candidateTargets);
  if (targetList.length === 0) {
    return { fixed: false, logs: ['Không xác định được file nguồn liên quan đến lỗi runtime.'] };
  }

  let modified = false;
  for (const relFile of targetList) {
    const fullPath = path.resolve(botRoot, relFile);
    if (!fs.existsSync(fullPath)) continue;
    let src = fs.readFileSync(fullPath, 'utf-8');

    // Deterministic fix 1: Markdown fence leftover
    const fenceFix = stripMarkdownFences(src);
    if (fenceFix.changed) {
      src = fenceFix.text;
      fs.writeFileSync(fullPath, src, 'utf-8');
      modified = true;
      logs.push(`[RuntimeFix] Gỡ code fence thừa trong ${relFile}`);
    }

    // Deterministic fix 2: Missing module import from stack trace ("Cannot find module '...'")
    const modErr = runtimeErrorLog.match(/Cannot find module '([^']+)'/);
    if (modErr && modErr[1].startsWith('.')) {
      const badRel = modErr[1];
      const targetBase = `${path.posix.basename(badRel).replace(/\.(js|ts)$/, '')}.ts`;
      const allSrc = listAllSrcFiles(path.join(botRoot, 'src')).map((f) => `src/${f}`);
      const candidate = allSrc.find((s) => path.posix.basename(s) === targetBase);
      if (candidate) {
        const corrected = computeRelativeModuleImport(relFile, candidate);
        if (src.includes(badRel) && corrected !== badRel) {
          src = src.split(badRel).join(corrected);
          fs.writeFileSync(fullPath, src, 'utf-8');
          modified = true;
          logs.push(`[RuntimeFix] Sửa import runtime '${badRel}' -> '${corrected}' trong ${relFile}`);
        }
      }
    }

    // Optional OpenAI stack-trace patch if configured
    if (!modified) {
      const aiRes = await attemptAiCodeRepair(botRoot, relFile, runtimeErrorLog, openAi);
      logs.push(aiRes.log);
      if (aiRes.repaired) {
        modified = true;
        break;
      }
    }
  }

  if (!modified) {
    return { fixed: false, logs };
  }

  const compileRes = await runTscCompile(botRoot);
  if (!compileRes.ok) {
    logs.push(`[RuntimeFix] Biên dịch lại sau khi vá thất bại:\n${compileRes.output.slice(0, 600)}`);
    return { fixed: false, logs };
  }

  logs.push('[RuntimeFix] Biên dịch tsc thành công, chuẩn bị khởi động lại bot...');
  return { fixed: true, logs };
}

export function createRollbackBackup(botRoot: string, targetRelFiles: string[]): RollbackManifest {
  const rollbackDir = path.join(botRoot, ROLLBACK_ROOT_NAME, `backup-${Date.now()}`);
  const filesDir = path.join(rollbackDir, 'files');
  fs.mkdirSync(filesDir, { recursive: true });

  const overwrittenFiles: string[] = [];
  const createdFiles: string[] = [];

  for (const rel of targetRelFiles) {
    const absTarget = path.resolve(botRoot, rel);
    if (fs.existsSync(absTarget)) {
      const absBackup = path.join(filesDir, rel);
      fs.mkdirSync(path.dirname(absBackup), { recursive: true });
      fs.copyFileSync(absTarget, absBackup);
      overwrittenFiles.push(rel);
    } else {
      createdFiles.push(rel);
    }
  }

  const manifest: RollbackManifest = {
    createdAt: Date.now(),
    rollbackDir,
    overwrittenFiles,
    createdFiles,
  };
  fs.writeFileSync(path.join(rollbackDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  return manifest;
}

export function restoreRollbackBackup(botRoot: string, rollbackDir: string): string[] {
  const manifestPath = path.join(rollbackDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return [];
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as RollbackManifest;
  const filesDir = path.join(rollbackDir, 'files');
  const restored: string[] = [];

  for (const rel of manifest.overwrittenFiles) {
    const srcBackup = path.join(filesDir, rel);
    const dstTarget = path.resolve(botRoot, rel);
    if (fs.existsSync(srcBackup)) {
      fs.mkdirSync(path.dirname(dstTarget), { recursive: true });
      fs.copyFileSync(srcBackup, dstTarget);
      restored.push(rel);
    }
  }

  for (const rel of manifest.createdFiles) {
    const dstTarget = path.resolve(botRoot, rel);
    if (fs.existsSync(dstTarget)) {
      fs.unlinkSync(dstTarget);
    }
  }

  return restored;
}

export function writePendingRestartState(botRoot: string, state: PendingRestartState): void {
  const dir = path.join(botRoot, ROLLBACK_ROOT_NAME);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pending-restart.json'), JSON.stringify(state, null, 2), 'utf-8');
}

export function readPendingRestartState(botRoot: string): PendingRestartState | null {
  const file = path.join(botRoot, ROLLBACK_ROOT_NAME, 'pending-restart.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as PendingRestartState;
  } catch {
    return null;
  }
}

export function clearPendingRestartState(botRoot: string): void {
  const file = path.join(botRoot, ROLLBACK_ROOT_NAME, 'pending-restart.json');
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

export function writeBootNotice(botRoot: string, notice: BootNotice): void {
  const dir = path.join(botRoot, ROLLBACK_ROOT_NAME);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'boot-notice.json'), JSON.stringify(notice, null, 2), 'utf-8');
}

export function consumeBootNotice(botRoot: string): BootNotice | null {
  const file = path.join(botRoot, ROLLBACK_ROOT_NAME, 'boot-notice.json');
  if (!fs.existsSync(file)) return null;
  try {
    const notice = JSON.parse(fs.readFileSync(file, 'utf-8')) as BootNotice;
    fs.unlinkSync(file);
    return notice;
  } catch {
    return null;
  }
}

export class HotUpdater {
  private watchTimer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(
    private readonly botRoot: string = process.cwd(),
    private readonly openAi?: OpenAiRepairConfig,
  ) {}

  public getHotUpdatesDir(): string {
    return path.join(this.botRoot, HOT_UPDATES_DIR_NAME);
  }

  public startWatching(onHotUpdateApplied: (result: HotUpdateResult, sourceFile: string) => Promise<void> | void): void {
    const dir = this.getHotUpdatesDir();
    const processedDir = path.join(dir, '.processed');
    if (!fs.existsSync(processedDir)) {
      fs.mkdirSync(processedDir, { recursive: true });
    }

    if (this.watchTimer) return;
    this.watchTimer = setInterval(() => {
      void this.pollWatchFolder(onHotUpdateApplied);
    }, 3000);
  }

  public stopWatching(): void {
    if (this.watchTimer) {
      clearInterval(this.watchTimer);
      this.watchTimer = null;
    }
  }

  private async pollWatchFolder(
    onHotUpdateApplied: (result: HotUpdateResult, sourceFile: string) => Promise<void> | void,
  ): Promise<void> {
    if (this.busy) return;
    const dir = this.getHotUpdatesDir();
    if (!fs.existsSync(dir)) return;

    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(
        (e) =>
          e.isFile() &&
          !e.name.startsWith('.') &&
          (e.name.endsWith('.ts') || e.name.endsWith('.json') || e.name.endsWith('.zip')),
      );

    if (entries.length === 0) return;

    const entry = entries[0];
    const fullPath = path.join(dir, entry.name);
    const processedPath = path.join(dir, '.processed', `${Date.now()}-${entry.name}`);

    try {
      const buf = fs.readFileSync(fullPath);
      fs.renameSync(fullPath, processedPath);

      const res = entry.name.endsWith('.zip')
        ? await this.applyZipBuffer(buf)
        : await this.applyFilesAndCompile([{ targetHint: entry.name, content: buf }]);

      await onHotUpdateApplied(res, entry.name);
      if (res.success) {
        setTimeout(() => this.triggerControlledRestart(), 800);
      }
    } catch (err) {
      console.error('[HotUpdater Watch Error]', err);
    }
  }

  public async applyZipBuffer(zipBuffer: Buffer): Promise<HotUpdateResult> {
    const zip = await JSZip.loadAsync(zipBuffer);
    const incoming: IncomingBotFile[] = [];

    for (const [rawName, zipObj] of Object.entries(zip.files)) {
      if (zipObj.dir) continue;
      if (
        rawName.includes('__MACOSX') ||
        rawName.includes('node_modules/') ||
        rawName.startsWith('dist/') ||
        rawName.includes('/dist/')
      ) {
        continue;
      }
      const ext = path.extname(rawName).toLowerCase();
      if (!ALLOWED_CODE_EXTENSIONS.has(ext)) continue;

      const content = await zipObj.async('nodebuffer');
      incoming.push({ targetHint: rawName, content });
    }

    if (incoming.length === 0) {
      return {
        success: false,
        compiled: false,
        autoFixed: false,
        rolledBack: false,
        updatedFiles: [],
        autoFixLogs: [],
        compilerOutput: '',
        error: 'File .zip không chứa file .ts hoặc .json hợp lệ.',
      };
    }

    return this.applyFilesAndCompile(incoming);
  }

  public async applyFilesAndCompile(incoming: IncomingBotFile[]): Promise<HotUpdateResult> {
    if (this.busy) {
      return {
        success: false,
        compiled: false,
        autoFixed: false,
        rolledBack: false,
        updatedFiles: [],
        autoFixLogs: [],
        compilerOutput: '',
        error: 'Hệ thống đang xử lý một bản cập nhật khác, vui lòng đợi vài giây.',
      };
    }

    this.busy = true;
    try {
      const resolvedTargets: Array<{ relPath: string; content: Buffer | string }> = [];
      for (const item of incoming) {
        const rel = resolveSafeBotTarget(this.botRoot, item.targetHint);
        if (!rel) {
          return {
            success: false,
            compiled: false,
            autoFixed: false,
            rolledBack: false,
            updatedFiles: [],
            autoFixLogs: [],
            compilerOutput: '',
            error: `Đường dẫn hoặc định dạng file không hợp lệ: ${item.targetHint} (chỉ hỗ trợ .ts / .json trong src/).`,
          };
        }
        resolvedTargets.push({ relPath: rel, content: item.content });
      }

      const relPaths = resolvedTargets.map((r) => r.relPath);
      const manifest = createRollbackBackup(this.botRoot, relPaths);

      const autoFixLogs: string[] = [];
      let autoFixed = false;

      for (const target of resolvedTargets) {
        const abs = path.resolve(this.botRoot, target.relPath);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        if (target.relPath.endsWith('.ts')) {
          const text = Buffer.isBuffer(target.content) ? target.content.toString('utf-8') : target.content;
          const stripped = stripMarkdownFences(text);
          if (stripped.changed) {
            autoFixed = true;
            autoFixLogs.push(`[AutoFix] Đã gỡ Markdown code fence thừa trong ${target.relPath}`);
          }
          fs.writeFileSync(abs, stripped.text, 'utf-8');
        } else {
          fs.writeFileSync(abs, target.content);
        }
      }

      let compileRes = await runTscCompile(this.botRoot);

      // Auto-fix loop (up to 3 repair passes if TypeScript errors occur)
      for (let attempt = 1; !compileRes.ok && attempt <= 3; attempt++) {
        const detFix = applyDeterministicTsFixes(this.botRoot, compileRes.diagnostics, relPaths);
        if (detFix.fixedAny) {
          autoFixed = true;
          autoFixLogs.push(...detFix.logs);
          compileRes = await runTscCompile(this.botRoot);
          if (compileRes.ok) break;
        }

        // Fallback AI repair on failing file if OPENAI_API_KEY is configured
        const primaryErrFile =
          compileRes.diagnostics[0]?.file && resolveSafeBotTarget(this.botRoot, compileRes.diagnostics[0].file)
            ? resolveSafeBotTarget(this.botRoot, compileRes.diagnostics[0].file)!
            : relPaths[0];
        const aiFix = await attemptAiCodeRepair(this.botRoot, primaryErrFile, compileRes.output, this.openAi);
        autoFixLogs.push(aiFix.log);
        if (aiFix.repaired) {
          autoFixed = true;
          compileRes = await runTscCompile(this.botRoot);
        } else if (!detFix.fixedAny) {
          break;
        }
      }

      if (!compileRes.ok) {
        restoreRollbackBackup(this.botRoot, manifest.rollbackDir);
        await runTscCompile(this.botRoot);
        return {
          success: false,
          compiled: false,
          autoFixed,
          rolledBack: true,
          updatedFiles: relPaths,
          autoFixLogs,
          compilerOutput: compileRes.output,
          error: 'Biên dịch TypeScript thất bại sau auto-fix; đã tự động khôi phục bản code cũ an toàn.',
        };
      }

      writePendingRestartState(this.botRoot, {
        createdAt: Date.now(),
        rollbackDir: manifest.rollbackDir,
        updatedFiles: relPaths,
        attempts: 0,
        maxAttempts: 2,
        autoFixLogs,
      });

      writeBootNotice(this.botRoot, {
        status: 'UPDATED',
        message: autoFixed
          ? `✅ Bot đã tự động cập nhật, vá lỗi compile & khởi động lại thành công (${relPaths.join(', ')}).`
          : `✅ Bot đã cập nhật code mới, biên dịch tsc & khởi động lại thành công (${relPaths.join(', ')}).`,
        updatedFiles: relPaths,
        timestamp: Date.now(),
      });

      return {
        success: true,
        compiled: true,
        autoFixed,
        rolledBack: false,
        updatedFiles: relPaths,
        autoFixLogs,
        compilerOutput: compileRes.output,
      };
    } finally {
      this.busy = false;
    }
  }

  public triggerControlledRestart(): void {
    if (process.env.SUPERVISED_BY_WATCHDOG === '1') {
      process.exit(HOT_RELOAD_EXIT_CODE);
      return;
    }

    // Fallback when launched via `node dist/index.js` directly without supervisor
    const supervisorEntry = path.resolve(this.botRoot, 'dist', 'supervisor.js');
    const directEntry = path.resolve(this.botRoot, 'dist', 'index.js');
    const entry = fs.existsSync(supervisorEntry) ? supervisorEntry : directEntry;

    const { spawn } = require('child_process') as typeof import('child_process');
    const child = spawn(process.execPath, [entry], {
      cwd: this.botRoot,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    process.exit(0);
  }
}
