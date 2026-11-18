import { Download } from 'lucide-react';

interface SetupGuideViewProps {
  onDownloadZip: () => void;
}

export function SetupGuideView({ onDownloadZip }: SetupGuideViewProps) {
  return (
    <div className="space-y-6 max-w-4xl">
      <section className="glass-panel rounded-xl p-6 sm:p-8 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-white">
              Hướng Dẫn Cài Đặt &amp; Sử Dụng Bot Từ A–Z
            </h2>
            <p className="text-sm text-slate-300 mt-1">
              Hướng dẫn từng bước dành cho người mới: từ cài đặt môi trường, điền file .env, chạy
              thử nghiệm PAPER đến LIVE 24/7 trên VPS với cơ chế tối ưu Profit Factor vốn nhỏ.
            </p>
          </div>
          <button
            type="button"
            onClick={onDownloadZip}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#00FFA3] to-emerald-400 text-slate-950 text-xs font-bold hover:brightness-110 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Tải solana-ai-sniper-bot.zip
          </button>
        </div>
      </section>

      {/* Step 1 */}
      <section className="glass-panel rounded-xl p-6 space-y-4">
        <h3 className="text-lg font-semibold text-white">
          Bước 1: Chuẩn bị môi trường &amp; thư viện hệ thống (Canvas + SQLite)
        </h3>
        <p className="text-sm text-slate-300 leading-relaxed">
          Bot yêu cầu <strong className="text-white">Node.js phiên bản v20 trở lên</strong>. Ngoài ra, module vẽ biểu đồ
          PNG (<code className="text-xs font-mono bg-slate-950/70 border border-white/10 px-1.5 py-0.5 rounded text-[#00FFA3]">chartjs-node-canvas</code>
          ) và database (<code className="text-xs font-mono bg-slate-950/70 border border-white/10 px-1.5 py-0.5 rounded text-[#00FFA3]">better-sqlite3</code>)
          cần thư viện đồ họa C++ của hệ điều hành:
        </p>

        <div className="space-y-3 text-xs font-mono bg-slate-950/80 border border-white/10 text-slate-200 p-4 rounded-xl overflow-x-auto">
          <div className="text-slate-500"># 1. Ubuntu / Debian VPS (Khuyên dùng để treo 24/7)</div>
          <div>curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -</div>
          <div>
            sudo apt-get install -y nodejs build-essential libcairo2-dev libpango1.0-dev
            libjpeg-dev libgif-dev librsvg2-dev python3
          </div>
          <div className="text-slate-500 pt-2"># 2. macOS (dùng Homebrew)</div>
          <div>brew install node@20 pkg-config cairo pango libpng jpeg giflib librsvg</div>
          <div className="text-slate-500 pt-2"># 3. Windows 10/11</div>
          <div>
            # Cài Node.js v20 LTS từ nodejs.org (tích chọn &quot;Automatically install necessary tools&quot;).
          </div>
        </div>
      </section>

      {/* Step 2 */}
      <section className="glass-panel rounded-xl p-6 space-y-4">
        <h3 className="text-lg font-semibold text-white">
          Bước 2: Điền 4 nhóm thông số cốt lõi vào file .env
        </h3>
        <p className="text-sm text-slate-300">
          Sau khi giải nén file <code className="text-xs font-mono bg-slate-950/70 border border-white/10 px-1.5 py-0.5 rounded text-slate-200">.zip</code>,
          chạy lệnh <code className="text-xs font-mono bg-slate-950/70 border border-white/10 px-1.5 py-0.5 rounded text-[#00FFA3]">cp .env.example .env</code>{' '}
          và điền các thông số sau:
        </p>

        <ol className="space-y-3 text-sm text-slate-300 list-decimal list-inside leading-relaxed">
          <li>
            <strong className="text-white">PRIVATE_KEY (Ví phụ Phantom):</strong> Mở Phantom Wallet → tạo một ví mới riêng
            biệt (chỉ nạp lượng SOL nhỏ để trade, tuyệt đối không dùng ví chính). Vào{' '}
            <em>Settings → Security &amp; Privacy → Show Private Key</em> và copy chuỗi Base58 dán vào{' '}
            <code className="font-mono text-xs bg-slate-950/70 border border-white/10 px-1.5 py-0.5 rounded text-[#00FFA3]">PRIVATE_KEY</code>.
          </li>
          <li>
            <strong className="text-white">Không cần mua gói RPC (DISCOVERY_MODE=FREE_FEED):</strong> Để trống{' '}
            <code className="font-mono text-xs bg-slate-950/70 border border-white/10 px-1.5 py-0.5 rounded text-slate-200">RPC_HTTPS_URL</code>{' '}
            và <code className="font-mono text-xs bg-slate-950/70 border border-white/10 px-1.5 py-0.5 rounded text-slate-200">RPC_WSS_URL</code>.
            Bot tự động chạy <strong className="text-white">FREE_FEED</strong> (luân phiên quét giữa DexScreener và GeckoTerminal mỗi 8s, tự động Failover khi 1 bên dính 429).
          </li>
          <li>
            <strong className="text-white">APP_API_PORT (Điều khiển trực tiếp qua App iOS):</strong> Đặt cổng{' '}
            <code className="font-mono text-xs bg-slate-950/70 border border-white/10 px-1.5 py-0.5 rounded text-[#00FFA3]">APP_API_PORT=3100</code>{' '}
            để kết nối trực tiếp với iOS App / Web App &amp; Hot-Update OTA.
          </li>
          <li>
            <strong className="text-white">WIFI_ONLY_MODE &amp; Tối ưu 4G:</strong> Giữ{' '}
            <code className="font-mono text-xs bg-slate-950/70 border border-white/10 px-1.5 py-0.5 rounded text-[#00FFA3]">WIFI_ONLY_MODE=true</code>{' '}
            để bot chỉ quét nền khi có Wi-Fi, hoặc tự chuyển sang compact + ETag 304 tiết kiệm băng thông trên 4G.
          </li>
        </ol>
      </section>

      {/* Step 3 */}
      <section className="glass-panel rounded-xl p-6 space-y-4">
        <h3 className="text-lg font-semibold text-white">
          Bước 3: Biên dịch &amp; chạy bot 24/7 với PM2
        </h3>
        <div className="space-y-2 text-xs font-mono bg-slate-950/80 border border-white/10 text-slate-200 p-4 rounded-xl overflow-x-auto">
          <div className="text-slate-500"># Giải nén và di chuyển vào thư mục dự án</div>
          <div>unzip solana-ai-sniper-bot.zip &amp;&amp; cd solana-ai-sniper-bot</div>
          <div className="text-slate-500 pt-2"># Cài thư viện và biên dịch TypeScript</div>
          <div>npm install &amp;&amp; npm run build</div>
          <div className="text-slate-500 pt-2"># Chạy thử trực tiếp (khuyến nghị giữ TRADING_MODE=PAPER trước)</div>
          <div>npm start</div>
          <div className="text-slate-500 pt-2"># Hoặc chạy ngầm 24/7 không bị tắt khi đóng Terminal bằng PM2</div>
          <div>npm install -g pm2 &amp;&amp; pm2 start dist/index.js --name solana-sniper</div>
        </div>
      </section>

      {/* Step 4 */}
      <section className="glass-panel rounded-xl p-6 space-y-4">
        <h3 className="text-lg font-semibold text-white">
          Bước 4: Cập nhật nóng (Hot-Update) cho App .IPA cũ &amp; Build mới
        </h3>
        <ul className="space-y-2.5 text-sm text-slate-300 leading-relaxed list-disc list-inside">
          <li>
            <strong className="text-white">Hot-Update không cần build lại Xcode (.IPA cũ):</strong> Bấm nút{' '}
            <em className="text-[#00FFA3]">.IPA &amp; Hot-Update</em> trên thanh Header để tải{' '}
            <code className="font-mono text-xs bg-slate-950/70 border border-white/10 px-1.5 py-0.5 rounded text-[#00FFA3]">solsniper-hotupdate-v2.2.json</code>{' '}
            hoặc <code className="font-mono text-xs bg-slate-950/70 border border-white/10 px-1.5 py-0.5 rounded text-violet-300">solsniper-hotupdate-bundle.zip</code>{' '}
            để nạp thẳng chiến lược Vốn nhỏ High-PF &amp; cấu hình mới vào app đang cài trên iPhone.
          </li>
          <li>
            <strong className="text-white">Tạo file .IPA Sideload mới (AltStore / SideStore / Sideloadly):</strong> Tải{' '}
            <code className="font-mono text-xs bg-slate-950/70 border border-white/10 px-1.5 py-0.5 rounded text-slate-200">SolSniperAI-iOS-IPA-Kit.zip</code>
            , push lên GitHub để Actions biên dịch <code className="font-mono text-xs text-slate-200">SolSniperAI-Unsigned.ipa</code>.
          </li>
          <li>
            <strong className="text-white">Auto-Consolidate &amp; Rent Reclaim:</strong> Sau khi bán hết vị thế, bot tự động
            đóng Token Account trống thu hồi{' '}
            <code className="font-mono text-xs bg-slate-950/70 border border-white/10 px-1.5 py-0.5 rounded text-[#00FFA3]">~0.00204 SOL</code>{' '}
            tiền rent mỗi ATA và gom lợi nhuận về ví lạnh.
          </li>
        </ul>
      </section>
    </div>
  );
}
