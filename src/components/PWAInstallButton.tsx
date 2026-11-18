import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle2,
  Download,
  FileArchive,
  FileJson,
  RefreshCw,
  Share,
  Smartphone,
  Terminal,
  Upload,
  X,
} from 'lucide-react';
import { registerSW } from 'virtual:pwa-register';
import { formatTransportErrorMessage, normalizeServerUrl } from '../lib/dataTransport';
import { isCapacitorNativeApp } from '../lib/nativeNetwork';
import {
  buildDefaultOtaBundle,
  OTA_BUNDLE_VERSION,
  OtaHotUpdateBundle,
  validateOtaHotUpdate,
} from '../lib/otaHotUpdate';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PWAInstallButtonProps {
  appliedOtaVersion: string | null;
  serverBaseUrl: string;
  onApplyOtaBundle: (bundle: OtaHotUpdateBundle) => void;
  onNavigateTransport?: () => void;
}

export function PWAInstallButton({
  appliedOtaVersion,
  serverBaseUrl,
  onApplyOtaBundle,
  onNavigateTransport,
}: PWAInstallButtonProps) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isNativeIpa, setIsNativeIpa] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [activeGuide, setActiveGuide] = useState<'ota' | 'ipa' | 'pwa'>('ota');
  const [offlineReady, setOfflineReady] = useState(false);
  const [otaStatus, setOtaStatus] = useState<string | null>(null);
  const [otaError, setOtaError] = useState<string | null>(null);
  const [checkingRemote, setCheckingRemote] = useState(false);

  useEffect(() => {
    const native = isCapacitorNativeApp();
    setIsNativeIpa(native);
    if (native) {
      setIsInstalled(true);
      return;
    }

    try {
      registerSW({
        immediate: true,
        onOfflineReady() {
          setOfflineReady(true);
        },
        onRegisterError() {
          // Ignore SW registration errors in restricted Safari iframes or private mode
        },
      });
    } catch {
      // Ignore SW errors in restricted WebKit contexts
    }

    const checkStandalone = () => {
      const nav = window.navigator as Navigator & { standalone?: boolean };
      const standalone =
        window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
      setIsInstalled(standalone);
    };

    checkStandalone();

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const triggerDownload = (path: string, filename: string) => {
    const cleanBase = normalizeServerUrl(serverBaseUrl);
    if (path === '/api/ota/download-json' && (isNativeIpa || !navigator.onLine) && !cleanBase) {
      const bundle = buildDefaultOtaBundle();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
      return;
    }

    const href = cleanBase ? `${cleanBase}${path}` : path;
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImportOtaFile = async (file: File | undefined) => {
    if (!file) return;
    setOtaError(null);
    setOtaStatus(null);
    try {
      const rawText = (await file.text()).trim();
      if (!rawText || rawText.startsWith('<')) {
        setOtaError('Tệp không phải định dạng JSON hợp lệ (hãy chọn solsniper-hotupdate-v2.2.json).');
        return;
      }
      const parsed = JSON.parse(rawText) as unknown;
      const checked = validateOtaHotUpdate(parsed);
      if (!checked.valid || !checked.bundle) {
        setOtaError(checked.error ?? 'Tệp hot-update không hợp lệ.');
        return;
      }
      onApplyOtaBundle(checked.bundle);
      setOtaStatus(
        `Đã nạp & kích hoạt OTA ${checked.bundle.version} (${checked.bundle.changelog.length} mục nâng cấp)!`,
      );
    } catch (err) {
      setOtaError(formatTransportErrorMessage(err, 'Không thể đọc tệp .json'));
    }
  };

  const handlePullRemoteOta = async () => {
    setCheckingRemote(true);
    setOtaError(null);
    setOtaStatus(null);
    try {
      const cleanBase = normalizeServerUrl(serverBaseUrl);
      if (isNativeIpa && !cleanBase) {
        const localBundle = buildDefaultOtaBundle();
        onApplyOtaBundle(localBundle);
        setOtaStatus(
          `Đã áp dụng gói OTA ${localBundle.version} tích hợp sẵn! (Nếu muốn kéo bản mới từ VPS, hãy điền Server URL trong tab Ví App).`,
        );
        return;
      }
      if (serverBaseUrl.trim() && !cleanBase) {
        setOtaError('Server URL không hợp lệ. Vui lòng kiểm tra lại URL trong tab Ví App.');
        return;
      }
      const url = `${cleanBase}/api/ota/manifest`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rawText = (await res.text()).trim();
      if (!rawText || rawText.startsWith('<')) {
        throw new Error('Server không trả về JSON OTA hợp lệ (kiểm tra lại Server URL).');
      }
      const json = JSON.parse(rawText) as unknown;
      const checked = validateOtaHotUpdate(json);
      if (!checked.valid || !checked.bundle) {
        setOtaError(checked.error ?? 'Manifest OTA không hợp lệ.');
        return;
      }
      onApplyOtaBundle(checked.bundle);
      setOtaStatus(`Đã đồng bộ OTA ${checked.bundle.version} từ Server thành công!`);
    } catch (err) {
      setOtaError(formatTransportErrorMessage(err, 'Lỗi kết nối Server OTA'));
    } finally {
      setCheckingRemote(false);
    }
  };

  const handleTriggerPwaPrompt = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setIsInstalled(true);
      }
      setDeferredPrompt(null);
      return;
    }
    setActiveGuide('pwa');
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        aria-label="Mở hộp thoại tải file .IPA và Hot-Update cho app iPhone cũ"
        className="inline-flex items-center justify-center gap-1.5 min-h-[36px] px-2.5 sm:px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 text-slate-100 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
      >
        <Smartphone className="w-3.5 h-3.5 text-[#00FFA3]" />
        <span className="hidden sm:inline">{isNativeIpa ? 'Hot-Update .IPA' : '.IPA & Hot-Update'}</span>
        <span className="sm:hidden">.IPA</span>
      </button>

      {showModal && typeof document !== 'undefined'
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="ios-ipa-title"
              className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-md p-0 sm:p-4"
            >
              <div className="w-full sm:max-w-xl bg-slate-900/90 backdrop-blur-xl rounded-t-3xl sm:rounded-2xl border border-white/15 p-5 sm:p-6 pb-8 space-y-4 shadow-[0_20px_60px_rgba(0,0,0,0.8)] max-h-[90vh] overflow-y-auto text-slate-100">
                <div className="w-10 h-1.5 bg-white/20 rounded-full mx-auto sm:hidden" />

                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 id="ios-ipa-title" className="text-base font-bold text-white">
                      {isNativeIpa
                        ? 'Hot-Update App .IPA & Cấu Hình iOS'
                        : 'Cập Nhật Nóng .IPA Cũ & Đóng Gói iOS'}
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5 font-mono tabular-nums">
                      Version: {appliedOtaVersion ?? OTA_BUNDLE_VERSION} · AltStore / SideStore / Sideloadly
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    aria-label="Đóng hộp thoại IPA"
                    className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-400 hover:bg-white/10 hover:text-white cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* 3-Tab Switcher */}
                <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-950/70 border border-white/10">
                  <button
                    type="button"
                    onClick={() => setActiveGuide('ota')}
                    className={`min-h-[38px] rounded-lg text-xs font-semibold cursor-pointer ${
                      activeGuide === 'ota'
                        ? 'bg-[#00FFA3]/20 text-[#00FFA3] border border-[#00FFA3]/40'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Hot-Update .IPA cũ
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveGuide('ipa')}
                    className={`min-h-[38px] rounded-lg text-xs font-semibold cursor-pointer ${
                      activeGuide === 'ipa'
                        ? 'bg-[#8B5CF6]/25 text-purple-200 border border-[#8B5CF6]/40'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Build .IPA Mới
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveGuide('pwa')}
                    className={`min-h-[38px] rounded-lg text-xs font-semibold cursor-pointer ${
                      activeGuide === 'pwa'
                        ? 'bg-white/15 text-white border border-white/20'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Safari PWA
                  </button>
                </div>

                {activeGuide === 'ota' ? (
                  <div className="space-y-3.5 text-xs">
                    <div className="p-3.5 rounded-xl bg-[#00FFA3]/10 border border-[#00FFA3]/30 text-slate-200 leading-relaxed">
                      Dùng tệp <strong className="font-mono text-[#00FFA3]">solsniper-hotupdate-v2.2.json</strong> để cập nhật trực tiếp chiến lược{' '}
                      <strong className="text-white">Vốn nhỏ (High-PF)</strong>, Jito Tip, ngưỡng TP/SL &amp; các bản vá bot vào app{' '}
                      <code className="font-mono text-[#00FFA3]">.ipa</code> đã cài sẵn trên iPhone mà không cần ký lại AltStore.
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() =>
                          triggerDownload('/api/ota/download-json', 'solsniper-hotupdate-v2.2.json')
                        }
                        className="min-h-[44px] inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-gradient-to-r from-[#00FFA3] to-[#10B981] text-slate-950 font-bold cursor-pointer hover:brightness-110"
                      >
                        <FileJson className="w-4 h-4" />
                        <span>Tải File Hot-Update (.json)</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          triggerDownload('/api/ota/download-zip', 'solsniper-hotupdate-bundle.zip')
                        }
                        className="min-h-[44px] inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-[#8B5CF6]/25 border border-[#8B5CF6]/50 text-purple-100 font-semibold cursor-pointer hover:bg-[#8B5CF6]/35"
                      >
                        <FileArchive className="w-4 h-4" />
                        <span>Tải Gói Full (.zip + Patch)</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <label className="min-h-[44px] inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 text-slate-100 font-semibold cursor-pointer">
                        <Upload className="w-4 h-4 text-[#00FFA3]" />
                        <span>Nạp &amp; Áp dụng File (.json)</span>
                        <input
                          type="file"
                          accept=".json,application/json"
                          className="hidden"
                          onChange={(e) => {
                            const selected = e.target.files?.[0];
                            e.target.value = '';
                            void handleImportOtaFile(selected);
                          }}
                        />
                      </label>

                      <button
                        type="button"
                        disabled={checkingRemote}
                        onClick={() => void handlePullRemoteOta()}
                        className="min-h-[44px] inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 text-slate-100 font-semibold cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw className={`w-4 h-4 ${checkingRemote ? 'animate-spin' : ''}`} />
                        <span>Đồng bộ OTA từ Server</span>
                      </button>
                    </div>

                    {otaStatus ? (
                      <div className="p-3 rounded-xl bg-[#00FFA3]/15 border border-[#00FFA3]/40 text-[#00FFA3] flex items-center gap-2 font-medium">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>{otaStatus}</span>
                      </div>
                    ) : null}

                    {otaError ? (
                      <div className="p-3 rounded-xl bg-[#FF3B6B]/15 border border-[#FF3B6B]/40 text-[#FF3B6B]">
                        {otaError}
                      </div>
                    ) : null}
                  </div>
                ) : activeGuide === 'ipa' ? (
                  <div className="space-y-3.5 text-xs text-slate-300">
                    <button
                      type="button"
                      onClick={() =>
                        triggerDownload('/api/download-ios-kit', 'SolSniperAI-iOS-IPA-Kit.zip')
                      }
                      className="w-full min-h-[46px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#10B981] to-[#8B5CF6] text-white font-bold cursor-pointer hover:brightness-110"
                    >
                      <FileArchive className="w-4 h-4" />
                      Tải Gói Build iOS (.zip + GitHub Actions tạo .IPA)
                    </button>

                    <ol className="space-y-2">
                      <li className="flex items-start gap-3 p-3 rounded-xl bg-slate-950/60 border border-white/10">
                        <span className="font-mono font-bold text-[#00FFA3]">01</span>
                        <div>
                          Giải nén <code className="font-mono text-white">SolSniperAI-iOS-IPA-Kit.zip</code> và push lên GitHub (hoặc chạy{' '}
                          <code className="font-mono text-white">./build-ipa.sh</code> trên macOS).
                        </div>
                      </li>
                      <li className="flex items-start gap-3 p-3 rounded-xl bg-slate-950/60 border border-white/10">
                        <span className="font-mono font-bold text-[#00FFA3]">02</span>
                        <div>
                          Vào <strong className="text-white">Actions → Build Unsigned iOS IPA</strong>, tải{' '}
                          <strong className="text-white">SolSniperAI-Unsigned.ipa</strong>.
                        </div>
                      </li>
                      <li className="flex items-start gap-3 p-3 rounded-xl bg-slate-950/60 border border-white/10">
                        <span className="font-mono font-bold text-[#00FFA3]">03</span>
                        <div>
                          Ký bằng <strong className="text-white">AltStore / SideStore / Sideloadly</strong> trên iPhone và cấp Tin cậy trong Cài đặt.
                        </div>
                      </li>
                    </ol>

                    {onNavigateTransport ? (
                      <button
                        type="button"
                        onClick={() => {
                          setShowModal(false);
                          onNavigateTransport();
                        }}
                        className="w-full min-h-[42px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/5 text-slate-200 font-semibold hover:bg-white/10 cursor-pointer"
                      >
                        <Terminal className="w-3.5 h-3.5" />
                        Cấu hình Server URL / Direct RPC trước khi xuất
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div className="space-y-3 text-xs text-slate-300">
                    {!isInstalled && deferredPrompt ? (
                      <button
                        type="button"
                        onClick={() => void handleTriggerPwaPrompt()}
                        className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#00FFA3] text-slate-950 font-bold hover:brightness-110 cursor-pointer"
                      >
                        <Download className="w-4 h-4" />
                        Cài App Ngay Lên Màn Hình Chính
                      </button>
                    ) : null}
                    <ol className="space-y-2">
                      <li className="flex items-start gap-3 p-3 rounded-xl bg-slate-950/60 border border-white/10">
                        <span className="font-mono font-bold text-[#00FFA3]">01</span>
                        <div>
                          Mở trên <strong className="text-white">Safari iOS</strong> → bấm{' '}
                          <span className="inline-flex items-center gap-1 font-semibold text-white">
                            <Share className="w-3.5 h-3.5" /> Chia sẻ (Share)
                          </span>
                          .
                        </div>
                      </li>
                      <li className="flex items-start gap-3 p-3 rounded-xl bg-slate-950/60 border border-white/10">
                        <span className="font-mono font-bold text-[#00FFA3]">02</span>
                        <div>
                          Chọn <strong className="text-white">Thêm vào MH chính</strong> → bấm{' '}
                          <strong className="text-white">Thêm</strong> ({offlineReady ? 'đã cache offline' : 'hỗ trợ cache offline'}).
                        </div>
                      </li>
                    </ol>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="w-full min-h-[42px] rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-white text-xs font-semibold cursor-pointer"
                >
                  Đóng
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
