import "server-only";
import { createPrivateKey, sign } from "node:crypto";
import { gunzipSync } from "node:zlib";

/**
 * App Store Connect API (api.appstoreconnect.apple.com), read-only: the Analytics Reports API, used to read how many
 * people downloaded Back and from where (source, referrer, campaign token ct=). Signed with the team's API key (a short
 * ES256 token per call). The key stays on the server; errors never include it.
 */
const API = "https://api.appstoreconnect.apple.com/v1";
type Fetch = typeof fetch;

export interface AscCredentials {
  issuerId: string;
  keyId: string;
  privateKey: string; // the .p8 file's text
}

export class AppStoreError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Checks the three parts of an API key before anything is stored. */
export function validateCredentials(c: AscCredentials): AscCredentials {
  const issuerId = c.issuerId.trim();
  const keyId = c.keyId.trim().toUpperCase();
  const privateKey = c.privateKey.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(issuerId)) throw new Error("The Issuer ID looks like 57246542-96fe-1a63-e053-0824d011072a (Users and Access → Integrations → App Store Connect API).");
  if (!/^[A-Z0-9]{10}$/.test(keyId)) throw new Error("The Key ID is 10 letters and digits, e.g. 2X9R4HXF34.");
  if (!privateKey.includes("BEGIN PRIVATE KEY")) throw new Error("Choose the .p8 file you downloaded when the key was created (it starts with -----BEGIN PRIVATE KEY-----).");
  try {
    const k = createPrivateKey(privateKey);
    if (k.asymmetricKeyType !== "ec") throw new Error("not ec");
  } catch {
    throw new Error("The .p8 file could not be read as an App Store Connect key.");
  }
  return { issuerId, keyId, privateKey };
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** A token valid for 15 minutes (Apple allows up to 20). */
export function ascToken(c: AscCredentials, now = Date.now()) {
  const header = b64url(JSON.stringify({ alg: "ES256", kid: c.keyId, typ: "JWT" }));
  const iat = Math.floor(now / 1000);
  const payload = b64url(JSON.stringify({ iss: c.issuerId, iat, exp: iat + 15 * 60, aud: "appstoreconnect-v1" }));
  const sig = sign("sha256", Buffer.from(`${header}.${payload}`), { key: createPrivateKey(c.privateKey), dsaEncoding: "ieee-p1363" });
  return `${header}.${payload}.${b64url(sig)}`;
}

type Doc<T> = { data: T; links?: { next?: string } };
type Res<A> = { id: string; type: string; attributes: A };

async function call<T>(c: AscCredentials, url: string, init: RequestInit = {}, f: Fetch = fetch): Promise<T> {
  const res = await f(url.startsWith("http") ? url : `${API}${url}`, {
    ...init,
    headers: { authorization: `Bearer ${ascToken(c)}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { errors?: Array<{ title?: string; detail?: string }> };
    const e = j.errors?.[0];
    const hint = res.status === 401 ? " Check the Issuer ID, Key ID and .p8 file." : res.status === 403 ? " The key needs the Admin role to request reports for the first time." : "";
    throw new AppStoreError(`App Store Connect ${res.status}: ${e?.detail ?? e?.title ?? "request failed"}.${hint}`.replace(/\.\./g, "."), res.status);
  }
  return (res.status === 204 ? {} : await res.json()) as T;
}

async function all<A>(c: AscCredentials, url: string, f: Fetch): Promise<Array<Res<A>>> {
  const out: Array<Res<A>> = [];
  let next: string | undefined = url;
  for (let i = 0; next && i < 20; i++) {
    const page: Doc<Array<Res<A>>> = await call<Doc<Array<Res<A>>>>(c, next, {}, f);
    out.push(...page.data);
    next = page.links?.next;
  }
  return out;
}

/** The app's name (also proves the key works for this app). */
export async function ascApp(c: AscCredentials, appId: string, f: Fetch = fetch) {
  const r = await call<Doc<Res<{ name: string; bundleId: string }>>>(c, `/apps/${encodeURIComponent(appId)}?fields[apps]=name,bundleId`, {}, f);
  return { name: r.data.attributes.name, bundleId: r.data.attributes.bundleId };
}

/** The ongoing report request for the app: reused when it exists, created otherwise (needs the Admin role once). */
export async function ensureReportRequest(c: AscCredentials, appId: string, f: Fetch = fetch) {
  const existing = await all<{ accessType: string; stoppedDueToInactivity?: boolean }>(c, `/apps/${encodeURIComponent(appId)}/analyticsReportRequests?limit=50`, f);
  const ongoing = existing.find((r) => r.attributes.accessType === "ONGOING" && !r.attributes.stoppedDueToInactivity);
  if (ongoing) return ongoing.id;
  const r = await call<Doc<Res<unknown>>>(c, "/analyticsReportRequests", {
    method: "POST",
    body: JSON.stringify({ data: { type: "analyticsReportRequests", attributes: { accessType: "ONGOING" }, relationships: { app: { data: { type: "apps", id: appId } } } } }),
  }, f);
  return r.data.id;
}

/** The downloads report of a request: the detailed one (it has the campaign token), else the standard one. */
export async function downloadsReport(c: AscCredentials, requestId: string, f: Fetch = fetch) {
  const reports = await all<{ name: string; category: string }>(c, `/analyticsReportRequests/${requestId}/reports?limit=200`, f);
  const dl = reports.filter((r) => /download/i.test(r.attributes.name));
  const pick = dl.find((r) => /detailed/i.test(r.attributes.name)) ?? dl.find((r) => /standard/i.test(r.attributes.name)) ?? dl[0];
  return pick ? { id: pick.id, name: pick.attributes.name } : null;
}

export async function dailyInstances(c: AscCredentials, reportId: string, f: Fetch = fetch) {
  const list = await all<{ granularity: string; processingDate: string }>(c, `/analyticsReports/${reportId}/instances?filter[granularity]=DAILY&limit=200`, f);
  return list.map((i) => ({ id: i.id, processingDate: i.attributes.processingDate }));
}

export async function instanceSegments(c: AscCredentials, instanceId: string, f: Fetch = fetch) {
  const list = await all<{ url: string; checksum: string; sizeInBytes: number }>(c, `/analyticsReportInstances/${instanceId}/segments?limit=200`, f);
  return list.map((s) => ({ id: s.id, url: s.attributes.url }));
}

/** A segment is a gzip'd tab-separated file at a signed URL (no key needed). Returns rows keyed by the header. */
export async function readSegment(url: string, f: Fetch = fetch) {
  const res = await f(url);
  if (!res.ok) throw new AppStoreError(`Report file ${res.status}`, res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  const text = (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString("utf8");
  return parseTsv(text);
}

export function parseTsv(text: string) {
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return [];
  const head = lines[0].split("\t").map((h) => h.trim());
  return lines.slice(1).map((l) => {
    const cells = l.split("\t");
    return Object.fromEntries(head.map((h, i) => [h, (cells[i] ?? "").trim()])) as Record<string, string>;
  });
}

/** The live App Store Connect calls, in the shape the app-store service expects. */
export const liveAscDeps = {
  app: (c: AscCredentials, appId: string) => ascApp(c, appId),
  ensureRequest: (c: AscCredentials, appId: string) => ensureReportRequest(c, appId),
  report: (c: AscCredentials, requestId: string) => downloadsReport(c, requestId),
  instances: (c: AscCredentials, reportId: string) => dailyInstances(c, reportId),
  segments: (c: AscCredentials, instanceId: string) => instanceSegments(c, instanceId),
  read: (url: string) => readSegment(url),
};
