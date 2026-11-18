import bs58 from 'bs58';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

export class WalletManager {
  public keypair: Keypair;
  public publicKey: PublicKey;
  public isEphemeralPaperWallet: boolean;

  constructor(privateKeyInput: string) {
    if (!privateKeyInput) {
      this.keypair = Keypair.generate();
      this.publicKey = this.keypair.publicKey;
      this.isEphemeralPaperWallet = true;
      return;
    }

    this.keypair = this.decodeKeypair(privateKeyInput);
    this.publicKey = this.keypair.publicKey;
    this.isEphemeralPaperWallet = false;
  }

  private decodeKeypair(privateKeyInput: string): Keypair {
    const trimmed = privateKeyInput.trim();
    if (trimmed.startsWith('[')) {
      const bytes = Uint8Array.from(JSON.parse(trimmed) as number[]);
      return Keypair.fromSecretKey(bytes);
    }
    const decoded = bs58.decode(trimmed);
    return Keypair.fromSecretKey(decoded);
  }

  public importPrivateKey(privateKeyInput: string): string {
    this.keypair = this.decodeKeypair(privateKeyInput);
    this.publicKey = this.keypair.publicKey;
    this.isEphemeralPaperWallet = false;
    return this.publicKey.toBase58();
  }

  public async getLiveSolBalance(connection: Connection): Promise<number> {
    if (this.isEphemeralPaperWallet) {
      return 0;
    }
    const lamports = await connection.getBalance(this.publicKey, 'confirmed');
    return lamports / LAMPORTS_PER_SOL;
  }

  public async getTokenBalanceUi(
    connection: Connection,
    mintAddress: string,
  ): Promise<{ rawAmount: string; uiAmount: number; decimals: number }> {
    const mint = new PublicKey(mintAddress);
    const ata = getAssociatedTokenAddressSync(mint, this.publicKey);
    try {
      const info = await connection.getTokenAccountBalance(ata, 'confirmed');
      return {
        rawAmount: info.value.amount,
        uiAmount: info.value.uiAmount ?? 0,
        decimals: info.value.decimals,
      };
    } catch {
      return { rawAmount: '0', uiAmount: 0, decimals: 6 };
    }
  }
}
