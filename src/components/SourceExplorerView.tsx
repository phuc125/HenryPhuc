import { useMemo, useState } from 'react';
import { Check, Copy, Download, FileCode2, Search } from 'lucide-react';
import type { BotProjectFile, BotProjectTree } from '../types/studio';
import { formatTransportErrorMessage, normalizeServerUrl } from '../lib/dataTransport';

interface SourceExplorerViewProps {
  project: BotProjectTree | null;
  loading: boolean;
  serverBaseUrl?: string;
  onDownloadZip: () => void;
  onProjectUpdated?: () => Promise<void> | void;
}

export function SourceExplorerView({
  project,
  loading,
  serverBaseUrl = '',
  onDownloadZip,
  onProjectUpdated,
}: SourceExplorerViewProps) {
  const [selectedPath, setSelectedPath] = useState<string>('src/security/antiRug.ts');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

  const files: BotProjectFile[] = project?.files ?? [];

  const filteredFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.path.toLowerCase().includes(q));
  }, [files, searchQuery]);

  const activeFile = useMemo(() => {
    return (
      files.find((f) => f.path === selectedPath) ??
      filteredFiles[0] ??
      files[0] ??
      null
    );
  }, [files, filteredFiles, selectedPath]);

  const handleCopy = async () => {
    if (!activeFile) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(activeFile.content);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      } else {
        setUploadStatus('Trình duyệt không hỗ trợ copy tự động trong môi trường hiện tại.');
      }
    } catch {
      setUploadStatus('Không thể copy tự động trong WebView/iframe.');
    }
  };

  const handleUploadHotUpdate = async (file: File | undefined) => {
    if (!file) return;
    setUploadStatus(`Compiling & auto-checking ${file.name}...`);
    try {
      const content = await file.text();
      const targetPath =
        activeFile && activeFile.path.endsWith(`/${file.name}`) ? activeFile.path : file.name;
      const cleanBase = normalizeServerUrl(serverBaseUrl);
      const endpoint = cleanBase ? `${cleanBase}/api/bot/hot-update` : '/api/bot/hot-update';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, targetPath, content }),
      });
      const rawText = await res.text();
      if (!rawText || rawText.trim().startsWith('<')) {
        setUploadStatus(
          `Server không phản hồi JSON hợp lệ (HTTP ${res.status}). Hãy đảm bảo đang kết nối đúng Server URL.`,
        );
        return;
      }
      const data = JSON.parse(rawText) as {
        success: boolean;
        filePath?: string;
        compilerOutput?: string;
        error?: string;
      };
      if (data.success && data.filePath) {
        setUploadStatus(`Updated ${data.filePath}: ${data.compilerOutput ?? 'Compiled OK'}`);
        setSelectedPath(data.filePath);
        await onProjectUpdated?.();
      } else {
        setUploadStatus(`Error: ${data.error ?? data.compilerOutput ?? 'Compile failed'}`);
      }
    } catch (err) {
      setUploadStatus(formatTransportErrorMessage(err, 'Upload failed'));
    }
  };

  if (loading) {
    return (
      <div className="glass-panel rounded-xl p-8 text-sm text-slate-400">
        Loading project source tree from disk...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 glass-panel rounded-xl px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold text-white">
            Complete Production Source Tree
          </h2>
          <p className="text-xs font-mono text-slate-400 tabular-nums">
            {project?.fileCount ?? 0} files · {project?.totalLines.toLocaleString() ?? 0} lines ·{' '}
            {((project?.totalBytes ?? 0) / 1024).toFixed(1)} KB uncompressed
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-white/10 bg-slate-950/60 text-slate-200 text-xs font-medium hover:bg-white/10 cursor-pointer">
            <span>Upload Hot-Update (.ts / .json)</span>
            <input
              type="file"
              accept=".ts,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                void handleUploadHotUpdate(file);
              }}
            />
          </label>
          <button
            type="button"
            onClick={onDownloadZip}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-[#00FFA3] to-emerald-400 text-slate-950 text-xs font-bold hover:brightness-110 transition-all whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Download Full Archive (.zip)
          </button>
        </div>
      </div>

      {uploadStatus ? (
        <div className="px-4 py-2.5 rounded-xl border border-[#00FFA3]/30 bg-emerald-500/10 text-xs font-mono text-[#00FFA3]">
          {uploadStatus}
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* File Tree Sidebar */}
        <div className="lg:col-span-4 glass-panel rounded-xl overflow-hidden">
          <div className="p-3 border-b border-white/10">
            <label htmlFor="file-filter-input" className="sr-only">
              Filter source files
            </label>
            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 pointer-events-none" />
              <input
                id="file-filter-input"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter path (e.g. antiRug, router)..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-950/70 border border-white/10 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-[#00FFA3]/50"
              />
            </div>
          </div>

          <div className="max-h-[640px] overflow-y-auto divide-y divide-white/5">
            {filteredFiles.length === 0 ? (
              <div className="p-4 text-xs text-slate-400">No files match &quot;{searchQuery}&quot;.</div>
            ) : (
              filteredFiles.map((file) => {
                const isSelected = activeFile?.path === file.path;
                return (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => setSelectedPath(file.path)}
                    className={`w-full text-left px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#00FFA3]/15 text-[#00FFA3] border-l-2 border-[#00FFA3]'
                        : 'text-slate-300 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0 truncate font-mono">
                      <FileCode2
                        className={`w-3.5 h-3.5 shrink-0 ${
                          isSelected ? 'text-[#00FFA3]' : 'text-slate-500'
                        }`}
                      />
                      <span className="truncate">{file.path}</span>
                    </span>
                    <span
                      className={`font-mono text-[11px] tabular-nums shrink-0 ${
                        isSelected ? 'text-[#00FFA3]' : 'text-slate-500'
                      }`}
                    >
                      {file.lines}L
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Code Viewer */}
        <div className="lg:col-span-8 glass-panel rounded-xl overflow-hidden">
          {activeFile ? (
            <>
              <div className="px-5 py-3 border-b border-white/10 bg-slate-950/60 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono text-xs font-semibold text-white truncate">
                    solana-ai-sniper-bot/{activeFile.path}
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 tabular-nums">
                    {activeFile.lines} lines · {(activeFile.sizeBytes / 1024).toFixed(2)} KB
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-slate-900/80 text-slate-200 text-xs font-medium hover:bg-white/10 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-[#00FFA3]" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy File
                    </>
                  )}
                </button>
              </div>

              <div className="max-h-[640px] overflow-auto bg-[#05070B] text-slate-100 p-4 font-mono text-xs leading-5">
                <table className="w-full border-collapse">
                  <tbody>
                    {activeFile.content.split('\n').map((line, idx) => (
                      <tr key={idx} className="hover:bg-white/5">
                        <td className="select-none pr-4 text-right text-slate-600 w-10 align-top tabular-nums">
                          {idx + 1}
                        </td>
                        <td className="whitespace-pre text-slate-200">{line || ' '}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="p-8 text-sm text-slate-400">Select a file from the left tree.</div>
          )}
        </div>
      </div>
    </div>
  );
}
