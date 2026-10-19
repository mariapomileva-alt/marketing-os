import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

/** Private file storage for knowledge sources and creative assets. Never served publicly. */
export interface FileStore {
  driver: "local" | "supabase";
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
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
}

let store: FileStore | null = null;
export function fileStore(): FileStore {
  if (store) return store;
  if (process.env.STORAGE_DRIVER === "supabase") {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("STORAGE_DRIVER=supabase needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    store = new SupabaseStore(url, key, process.env.SUPABASE_STORAGE_BUCKET ?? "knowledge");
  } else {
    store = new LocalStore(path.resolve(process.cwd(), process.env.STORAGE_LOCAL_DIR ?? ".data/storage"));
  }
  return store;
}
