import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { storageDriver, supabaseServiceKey, supabaseUrl } from "@/server/env";

/** Private file storage for knowledge sources and creative assets. Never served publicly. */
export interface FileStore {
  driver: "local" | "supabase";
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  /** A short-lived URL to read the file without credentials (Supabase only; null for local storage). */
  signedUrl(key: string, seconds: number): Promise<string | null>;
  /** A one-time URL the browser can upload one file to directly (Supabase only; null for local storage). */
  signedUploadUrl(key: string): Promise<string | null>;
}

function safeKey(key: string): string {
  const k = key.replace(/\\/g, "/");
  if (k.includes("..") || k.startsWith("/")) throw new Error("Invalid storage key");
  return k;
}

class LocalStore implements FileStore {
  readonly driver = "local" as const;
  constructor(private root: string) {}
  async put(key: string, bytes: Uint8Array) {
    const file = path.join(this.root, safeKey(key));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }
  async get(key: string) {
    return new Uint8Array(await readFile(path.join(this.root, safeKey(key))));
  }
  async signedUrl() {
    return null;
  }
  async signedUploadUrl() {
    return null;
  }
}

class SupabaseStore implements FileStore {
  readonly driver = "supabase" as const;
  private client;
  constructor(url: string, serviceKey: string, private bucket: string) {
    this.client = createClient(url, serviceKey, { auth: { persistSession: false } });
  }
  async put(key: string, bytes: Uint8Array, contentType: string) {
    const { error } = await this.client.storage.from(this.bucket).upload(safeKey(key), bytes, { contentType, upsert: false });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
  }
  async get(key: string) {
    const { data, error } = await this.client.storage.from(this.bucket).download(safeKey(key));
    if (error || !data) throw new Error(`Storage download failed: ${error?.message ?? "no data"}`);
    return new Uint8Array(await data.arrayBuffer());
  }
  async signedUrl(key: string, seconds: number) {
    const { data, error } = await this.client.storage.from(this.bucket).createSignedUrl(safeKey(key), seconds);
    if (error || !data) throw new Error(`Storage link failed: ${error?.message ?? "no data"}`);
    return data.signedUrl;
  }
  async signedUploadUrl(key: string) {
    const { data, error } = await this.client.storage.from(this.bucket).createSignedUploadUrl(safeKey(key));
    if (error || !data) throw new Error(`Storage upload link failed: ${error?.message ?? "no data"}`);
    return data.signedUrl;
  }
}

let store: FileStore | null = null;
export function fileStore(): FileStore {
  if (store) return store;
  if (storageDriver() === "supabase") {
    const url = supabaseUrl();
    const key = supabaseServiceKey();
    if (!url || !key) throw new Error("Supabase storage needs the Supabase URL and SUPABASE_SERVICE_ROLE_KEY");
    store = new SupabaseStore(url, key, process.env.SUPABASE_STORAGE_BUCKET ?? "knowledge");
  } else {
    store = new LocalStore(path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.STORAGE_LOCAL_DIR ?? ".data/storage"));
  }
  return store;
}
