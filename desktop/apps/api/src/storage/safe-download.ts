import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { BadRequestException } from "@nestjs/common";
import axios from "axios";

const MAX_REDIRECTS = 5;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

export type SafeDownloadOptions = {
  responseType: "arraybuffer";
  timeout: number;
  maxContentLength: number;
  maxBodyLength: number;
  headersForUrl?: (url: string) => Record<string, string>;
};

export type SafeDownloadRuntime = {
  lookup?: typeof dns.lookup;
  request?: (url: string, config: Record<string, unknown>) => Promise<{
    status?: number;
    headers?: unknown;
    data: ArrayBuffer | Buffer | Uint8Array;
  }>;
};

type ResolvedAddress = { address: string; family: 4 | 6 };

export async function downloadBoundedBytes(
  sourceUrl: string,
  options: SafeDownloadOptions,
  runtime: SafeDownloadRuntime = {},
): Promise<Buffer> {
  const lookup = runtime.lookup || dns.lookup;
  const request = runtime.request || ((url, config) => axios.get<ArrayBuffer>(url, config));
  let currentUrl = sourceUrl;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const target = await resolvePublicDownloadTarget(currentUrl, lookup);
    const pinnedLookup = createPinnedLookup(target.hostname, target.addresses);
    const agent = target.url.protocol === "https:"
      ? new https.Agent({ lookup: pinnedLookup })
      : new http.Agent({ lookup: pinnedLookup });
    const headers = options.headersForUrl?.(target.url.toString()) || {};
    let response;
    try {
      response = await request(target.url.toString(), {
        responseType: options.responseType,
        timeout: options.timeout,
        maxContentLength: options.maxContentLength,
        maxBodyLength: options.maxBodyLength,
        maxRedirects: 0,
        proxy: false,
        validateStatus: (status: number) => status >= 200 && status < 400,
        ...(target.url.protocol === "https:" ? { httpsAgent: agent } : { httpAgent: agent }),
        ...(Object.keys(headers).length ? { headers } : {}),
      });
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (isDownloadSizeError(error)) throw downloadSizeException(options.maxContentLength);
      throw error;
    } finally {
      agent.destroy();
    }

    const status = Number(response.status || 200);
    if (REDIRECT_STATUS.has(status)) {
      if (redirectCount === MAX_REDIRECTS) throw new BadRequestException("asset URL redirect limit exceeded");
      const location = responseHeader(response.headers, "location");
      if (!location) throw new BadRequestException("asset URL redirect is missing location");
      currentUrl = new URL(location, target.url).toString();
      continue;
    }
    if (status < 200 || status >= 300) throw new BadRequestException("asset URL returned an unsupported response status");
    const buffer = response.data instanceof ArrayBuffer
      ? Buffer.from(new Uint8Array(response.data))
      : Buffer.from(response.data);
    if (buffer.length > options.maxContentLength || buffer.length > options.maxBodyLength) {
      throw downloadSizeException(Math.min(options.maxContentLength, options.maxBodyLength));
    }
    return buffer;
  }

  throw new BadRequestException("asset URL redirect limit exceeded");
}

export async function resolvePublicDownloadTarget(
  input: string,
  lookup: typeof dns.lookup = dns.lookup,
): Promise<{ url: URL; hostname: string; addresses: ResolvedAddress[] }> {
  let url: URL;
  try {
    url = new URL(String(input || "").trim());
  } catch {
    throw new BadRequestException("asset URL must use http(s)");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BadRequestException("asset URL must use http(s)");
  }
  if (url.username || url.password) throw new BadRequestException("asset URL credentials are forbidden");
  const hostname = normalizeHostname(url.hostname);
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new BadRequestException("asset URL must resolve only to public addresses");
  }

  const literalFamily = net.isIP(hostname);
  let resolved: ResolvedAddress[];
  try {
    resolved = literalFamily
      ? [{ address: hostname, family: literalFamily as 4 | 6 }]
      : normalizeLookupResults(await lookup(hostname, { all: true, verbatim: true }));
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException("asset URL DNS resolution did not produce public addresses");
  }
  if (!resolved.length || resolved.some((item) => !isPublicAddress(item.address))) {
    throw new BadRequestException("asset URL must resolve only to public addresses");
  }
  return { url, hostname, addresses: resolved };
}

function normalizeLookupResults(value: unknown): ResolvedAddress[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map((entry) => {
    const candidate = entry as { address?: unknown; family?: unknown };
    const address = normalizeHostname(String(candidate.address || ""));
    const family = Number(candidate.family || net.isIP(address));
    if (!address || (family !== 4 && family !== 6) || net.isIP(address) !== family) {
      throw new BadRequestException("asset URL DNS response is invalid");
    }
    return { address, family } as ResolvedAddress;
  });
}

function createPinnedLookup(expectedHostname: string, addresses: ResolvedAddress[]) {
  return (requestedHostname: string, rawOptions: unknown, rawCallback?: unknown) => {
    const options = typeof rawOptions === "function" ? {} : (rawOptions || {}) as { all?: boolean; family?: number };
    const callback = (typeof rawOptions === "function" ? rawOptions : rawCallback) as (
      error: Error | null,
      address?: string | ResolvedAddress[],
      family?: number,
    ) => void;
    if (normalizeHostname(requestedHostname) !== expectedHostname) {
      callback(new Error("pinned DNS hostname mismatch"));
      return;
    }
    const family = Number(options.family || 0);
    const eligible = family === 4 || family === 6 ? addresses.filter((item) => item.family === family) : addresses;
    if (!eligible.length) {
      callback(new Error("pinned DNS family unavailable"));
      return;
    }
    if (options.all) callback(null, eligible);
    else callback(null, eligible[0].address, eligible[0].family);
  };
}

export function isPublicAddress(input: string): boolean {
  const address = normalizeHostname(input);
  const family = net.isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family !== 6) return false;
  const words = parseIpv6Words(address);
  if (!words) return false;
  if (matchesIpv6Prefix(words, "::ffff:0:0", 96)) {
    return isPublicIpv4(`${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`);
  }
  if (!matchesIpv6Prefix(words, "2000::", 3)) return false;
  return ![
    ["2001::", 32],
    ["2001:2::", 48],
    ["2001:10::", 28],
    ["2001:20::", 28],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["3fff::", 20],
  ].some(([prefix, bits]) => matchesIpv6Prefix(words, String(prefix), Number(bits)));
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  const value = (((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3]) >>> 0;
  return ![
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ].some(([base, bits]) => ipv4PrefixMatch(value, String(base), Number(bits)));
}

function ipv4PrefixMatch(value: number, base: string, bits: number) {
  const octets = base.split(".").map(Number);
  const baseValue = (((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3]) >>> 0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

function parseIpv6Words(input: string): number[] | null {
  let address = normalizeHostname(input);
  if (address.includes("%") || address.split("::").length > 2) return null;
  const expandIpv4Tail = (part: string) => {
    const tokens = part ? part.split(":") : [];
    const tail = tokens.at(-1) || "";
    if (!tail.includes(".")) return tokens;
    if (!isPublicOrSpecialIpv4Syntax(tail)) return null;
    const octets = tail.split(".").map(Number);
    return [...tokens.slice(0, -1), ((octets[0] << 8) | octets[1]).toString(16), ((octets[2] << 8) | octets[3]).toString(16)];
  };
  const [leftRaw, rightRaw = ""] = address.split("::");
  const left = expandIpv4Tail(leftRaw);
  const right = expandIpv4Tail(rightRaw);
  if (!left || !right) return null;
  const missing = 8 - left.length - right.length;
  if ((address.includes("::") && missing < 1) || (!address.includes("::") && missing !== 0)) return null;
  const tokens = [...left, ...Array(Math.max(0, missing)).fill("0"), ...right];
  if (tokens.length !== 8 || tokens.some((token) => !/^[a-f0-9]{1,4}$/i.test(token))) return null;
  return tokens.map((token) => Number.parseInt(token, 16));
}

function isPublicOrSpecialIpv4Syntax(input: string) {
  const octets = input.split(".").map(Number);
  return octets.length === 4 && octets.every((value) => Number.isInteger(value) && value >= 0 && value <= 255);
}

function matchesIpv6Prefix(words: number[], prefix: string, bits: number) {
  const prefixWords = parseIpv6Words(prefix);
  if (!prefixWords) return false;
  const value = words.reduce((result, word) => (result << 16n) | BigInt(word), 0n);
  const expected = prefixWords.reduce((result, word) => (result << 16n) | BigInt(word), 0n);
  const mask = bits === 0 ? 0n : ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits);
  return (value & mask) === (expected & mask);
}

function normalizeHostname(value: string) {
  return String(value || "").trim().replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

function responseHeader(headers: unknown, name: string): string {
  if (!headers) return "";
  const candidate = headers as { get?: (key: string) => unknown; [key: string]: unknown };
  if (typeof candidate.get === "function") return String(candidate.get(name) || "").trim();
  return String(candidate[name] || candidate[name.toLowerCase()] || "").trim();
}

function isDownloadSizeError(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const code = String(candidate?.code || "");
  const message = String(candidate?.message || "");
  return code === "ERR_FR_MAX_BODY_LENGTH_EXCEEDED"
    || /max(?:Content|Body)Length|maximum (?:content|body) length|size of \d+ exceeded/i.test(message);
}

function downloadSizeException(limit: number): BadRequestException {
  return new BadRequestException(`asset exceeds maximum size of ${limit} bytes`);
}
