export interface Track { bvid: string; title: string; artist: string; cover: string; duration: number; cid?: number }
export interface Playlist { id: string; name: string; tracks: Track[] }
export interface Library { playlists: Playlist[]; history: Track[]; lyrics: Record<string, string>; volume: number; repeat: 'off' | 'all' | 'one' }
export interface Account { mid: number; name: string }
export interface Favorite { id: number; title: string; count: number }
export interface Part { cid: number; title: string; duration: number }
export interface Desktop {
  loadLibrary(): Promise<Library>;
  saveLibrary(input: Library): Promise<void>;
  exportLibrary(): Promise<boolean>;
  importLibrary(): Promise<Library | null>;
  search(keyword: string, page: number): Promise<{ tracks: Track[]; pages: number }>;
  stream(bvid: string, cid?: number): Promise<{ url: string; track: Track; parts: Part[] }>;
  account(): Promise<Account | null>;
  qrGenerate(): Promise<{ key: string; url: string }>;
  qrPoll(key: string): Promise<{ code: number; account?: Account | null }>;
  logout(): Promise<void>;
  favorites(): Promise<Favorite[]>;
  favoriteTracks(id: number, page: number): Promise<{ tracks: Track[]; hasMore: boolean }>;
  windowControl(action: 'minimize' | 'maximize' | 'close'): Promise<void>;
  onPlayerCommand(callback: (command: string) => void): () => void;
}
declare global { interface Window { desktop: Desktop } }
