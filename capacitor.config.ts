import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.solsniper.ai',
  appName: 'SolSniper AI',
  webDir: 'dist',
  plugins: {
    CapacitorHttp: {
      // Enable native URLSession HTTP inside WKWebView so Direct DexScreener / GeckoTerminal /
      // Solana RPC requests work from capacitor://localhost without browser CORS blocks.
      enabled: true,
    },
  },
  ios: {
    contentInset: 'always',
    scrollEnabled: true,
    backgroundColor: '#f8fafc',
  },
};

export default config;
