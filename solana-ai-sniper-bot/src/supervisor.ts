import { ChildProcess, spawn } from 'child_process';
import dotenv from 'dotenv';
import path from 'path';
import {
  attemptRuntimeAutoFixAndRecompile,
  clearPendingRestartState,
  HOT_RELOAD_EXIT_CODE,
  readPendingRestartState,
  restoreRollbackBackup,
  runTscCompile,
  writeBootNotice,
  writePendingRestartState,
} from './updater/hotUpdater';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const BOT_ROOT = process.cwd();
const ENTRY_SCRIPT = path.resolve(BOT_ROOT, 'dist', 'index.js');
const STABLE_UPTIME_MS = 12_000;

let activeChild: ChildProcess | null = null;
let shuttingDown = false;

async function handleCrashWithAutoHeal(exitCode: number | null, recentLogs: string): Promise<number> {
  const pending = readPendingRestartState(BOT_ROOT);

  if (!pending) {
    console.error(`[Supervisor] Bot exited unexpectedly (code=${exitCode}). Restarting in 3s...`);
    return 3000;
  }

  console.error(
    `[Supervisor] Newly updated build crashed during boot/runtime (attempt ${pending.attempts + 1}/${pending.maxAttempts}). Error tail:\n${recentLogs.slice(
      -900,
    )}`,
  );

  if (pending.attempts < pending.maxAttempts) {
    const nextAttempt = pending.attempts + 1;
    const repair = await attemptRuntimeAutoFixAndRecompile(BOT_ROOT, recentLogs, pending, {
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL,
    });

    if (repair.fixed) {
      writePendingRestartState(BOT_ROOT, {
        ...pending,
        attempts: nextAttempt,
        autoFixLogs: [...pending.autoFixLogs, ...repair.logs],
      });
      writeBootNotice(BOT_ROOT, {
        status: 'AUTO_FIXED_RUNTIME',
        message: `Đã tự sửa lỗi khi chạy (Runtime Auto-Fix lần ${nextAttempt}) và khởi động lại thành công:\n${repair.logs
          .slice(-4)
          .join('\n')}`,
        updatedFiles: pending.updatedFiles,
        timestamp: Date.now(),
      });
      return 500;
    }

    pending.autoFixLogs.push(...repair.logs);
  }

  // Auto-fix exhausted or failed -> rollback to known-good backup & recompile
  console.error('[Supervisor] Runtime auto-fix could not recover update. Rolling back to backup...');
  const restored = restoreRollbackBackup(BOT_ROOT, pending.rollbackDir);
  await runTscCompile(BOT_ROOT);
  clearPendingRestartState(BOT_ROOT);

  const summary = [
    `Cập nhật mới gặp lỗi khi chạy — ĐÃ TỰ ĐỘNG ROLLBACK!`,
    `File khôi phục: ${restored.join(', ') || pending.updatedFiles.join(', ')}`,
    `Chi tiết lỗi:\n${recentLogs.slice(-500)}`,
  ].join('\n');

  writeBootNotice(BOT_ROOT, {
    status: 'ROLLED_BACK',
    message: summary,
    updatedFiles: restored,
    timestamp: Date.now(),
  });
  return 1000;
}

function launchChild(): void {
  if (shuttingDown) return;

  const recentLines: string[] = [];
  const pushLogs = (chunk: Buffer, isErr: boolean) => {
    const str = chunk.toString('utf-8');
    if (isErr) process.stderr.write(str);
    else process.stdout.write(str);
    for (const line of str.split(/\r?\n/)) {
      if (line.trim()) {
        recentLines.push(line);
        if (recentLines.length > 90) recentLines.shift();
      }
    }
  };

  const startedAt = Date.now();
  const child = spawn(process.execPath, [ENTRY_SCRIPT], {
    cwd: BOT_ROOT,
    env: {
      ...process.env,
      SUPERVISED_BY_WATCHDOG: '1',
    },
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  activeChild = child;

  child.stdout?.on('data', (d: Buffer) => pushLogs(d, false));
  child.stderr?.on('data', (d: Buffer) => pushLogs(d, true));

  const stabilityTimer = setTimeout(() => {
    const pending = readPendingRestartState(BOT_ROOT);
    if (pending && Date.now() - startedAt >= STABLE_UPTIME_MS) {
      clearPendingRestartState(BOT_ROOT);
      console.log('[Supervisor] Hot-updated build passed runtime stability window.');
    }
  }, STABLE_UPTIME_MS + 500);

  child.on('exit', (code) => {
    clearTimeout(stabilityTimer);
    activeChild = null;
    if (shuttingDown) {
      process.exit(0);
      return;
    }

    if (code === HOT_RELOAD_EXIT_CODE) {
      console.log('[Supervisor] Hot-reload requested. Starting newly compiled build...');
      setTimeout(launchChild, 250);
      return;
    }

    if (code === 0) {
      console.log('[Supervisor] Bot exited cleanly.');
      process.exit(0);
      return;
    }

    const logTail = recentLines.join('\n');
    void handleCrashWithAutoHeal(code, logTail).then((delayMs) => {
      setTimeout(launchChild, delayMs);
    });
  });
}

function shutdownSupervisor(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Supervisor] Caught ${signal}, stopping bot...`);
  if (activeChild) {
    activeChild.kill('SIGTERM');
    setTimeout(() => {
      activeChild?.kill('SIGKILL');
      process.exit(0);
    }, 4000);
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdownSupervisor('SIGINT'));
process.on('SIGTERM', () => shutdownSupervisor('SIGTERM'));

console.log('[Supervisor] Starting Solana Quant Sniper Watchdog...');
launchChild();
