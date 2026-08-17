"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", experimentalDecorators: true, emitDecoratorMetadata: true },
});

const { AssetsController } = require("../apps/api/src/assets/assets.controller");
const { DesignJobsController } = require("../apps/api/src/design-jobs/design-jobs.controller");
const { appConfig } = require("../apps/api/src/shared/app-config");
const {
  StorageService,
  downloadBoundedBytes,
  inspectSafeAssetContent,
} = require("../apps/api/src/storage/storage.service");

const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAkAAAAICAIAAACkr0LiAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVR4nGOowA0YhoEcAE90ZUHwfJsHAAAAAElFTkSuQmCC",
  "base64",
);
const SAFE_PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<<>>\n%%EOF\n", "ascii");

function publicLookup(addressesByHost, calls = []) {
  return async (hostname, options) => {
    calls.push({ hostname, options });
    const addresses = addressesByHost[hostname];
    if (!addresses) throw new Error(`unexpected DNS lookup: ${hostname}`);
    return addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  };
}

function safeDownloadOptions(overrides = {}) {
  return {
    responseType: "arraybuffer",
    timeout: 1000,
    maxContentLength: 1024,
    maxBodyLength: 1024,
    ...overrides,
  };
}

test("public-network downloader pins validated DNS and never performs a second resolver lookup", async () => {
  const dnsCalls = [];
  const requests = [];
  const lookup = publicLookup({ "public.example": ["93.184.216.34"] }, dnsCalls);
  const request = async (url, config) => {
    requests.push({ url, config });
    const pinned = await new Promise((resolve, reject) => {
      config.httpsAgent.options.lookup("public.example", { family: 4 }, (error, address, family) => {
        if (error) reject(error);
        else resolve({ address, family });
      });
    });
    assert.deepEqual(pinned, { address: "93.184.216.34", family: 4 });
    return { status: 200, headers: {}, data: VALID_PNG };
  };

  const bytes = await downloadBoundedBytes(
    "https://public.example/image.png",
    safeDownloadOptions(),
    { lookup, request },
  );

  assert.deepEqual(bytes, VALID_PNG);
  assert.equal(dnsCalls.length, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].config.maxRedirects, 0);
  assert.equal(requests[0].config.headers, undefined);
});

test("public-network downloader rejects credentials and every local, private, link-local or reserved target before request", async () => {
  let requests = 0;
  const request = async () => {
    requests += 1;
    return { status: 200, headers: {}, data: VALID_PNG };
  };
  const lookup = publicLookup({
    "mixed.example": ["93.184.216.34", "10.0.0.8"],
  });
  const blocked = [
    "https://user:password@public.example/a.png",
    "http://127.0.0.1/a.png",
    "http://10.0.0.1/a.png",
    "http://169.254.169.254/latest/meta-data",
    "http://0.0.0.0/a.png",
    "http://224.0.0.1/a.png",
    "http://[::1]/a.png",
    "http://[::ffff:127.0.0.1]/a.png",
    "http://[fc00::1]/a.png",
    "http://[fe80::1]/a.png",
    "http://[2001:db8::1]/a.png",
    "https://mixed.example/a.png",
    "https://unresolved.example/a.png",
  ];

  for (const url of blocked) {
    await assert.rejects(
      () => downloadBoundedBytes(url, safeDownloadOptions(), { lookup, request }),
      (error) => error?.getStatus?.() === 400 && /public|credential|address/i.test(error.message),
      url,
    );
  }
  assert.equal(requests, 0);
});

test("loopback image downloads require an explicit acceptance origin and keep redirects fenced", async () => {
  const requests = [];
  const request = async (url, config) => {
    requests.push({ url, config });
    return { status: 200, headers: {}, data: VALID_PNG };
  };

  const bytes = await downloadBoundedBytes(
    "http://127.0.0.1:3700/files/result.png",
    safeDownloadOptions({ allowLoopbackOrigins: ["http://127.0.0.1:3700"] }),
    { request },
  );

  assert.deepEqual(bytes, VALID_PNG);
  assert.equal(requests.length, 1);

  await assert.rejects(
    () => downloadBoundedBytes(
      "http://127.0.0.1:3701/files/result.png",
      safeDownloadOptions({ allowLoopbackOrigins: ["http://127.0.0.1:3700"] }),
      { request },
    ),
    /public addresses/i,
  );

  await assert.rejects(
    () => downloadBoundedBytes(
      "http://127.0.0.1:3700/files/result.png",
      safeDownloadOptions({ allowLoopbackOrigins: ["http://127.0.0.1:3700"] }),
      {
        request: async () => ({ status: 302, headers: { location: "http://127.0.0.1:3701/files/result.png" }, data: Buffer.alloc(0) }),
      },
    ),
    /public addresses/i,
  );
});

test("redirects are revalidated per hop and design credentials stay on the configured origin", async () => {
  const dnsCalls = [];
  const requests = [];
  const lookup = publicLookup({
    "design.example": ["93.184.216.34"],
    "cdn.example": ["93.184.216.35"],
  }, dnsCalls);
  const request = async (url, config) => {
    requests.push({ url, config });
    if (requests.length === 1) {
      return { status: 302, headers: { location: "https://cdn.example/final.png" }, data: Buffer.alloc(0) };
    }
    return { status: 200, headers: {}, data: VALID_PNG };
  };
  const headersForUrl = (url) => new URL(url).origin === "https://design.example"
    ? { Authorization: "Bearer protected-token", Cookie: "sid=protected" }
    : {};

  await downloadBoundedBytes(
    "https://design.example/start.png",
    safeDownloadOptions({ headersForUrl }),
    { lookup, request },
  );

  assert.deepEqual(dnsCalls.map((item) => item.hostname), ["design.example", "cdn.example"]);
  assert.equal(requests[0].config.headers.Authorization, "Bearer protected-token");
  assert.equal(requests[1].config.headers, undefined);

  let privateRequests = 0;
  await assert.rejects(
    () => downloadBoundedBytes(
      "https://design.example/start.png",
      safeDownloadOptions(),
      {
        lookup,
        request: async () => {
          privateRequests += 1;
          return { status: 302, headers: { location: "http://169.254.169.254/latest" }, data: Buffer.alloc(0) };
        },
      },
    ),
    /public address/i,
  );
  assert.equal(privateRequests, 1);

  let loopRequests = 0;
  await assert.rejects(
    () => downloadBoundedBytes(
      "https://design.example/loop.png",
      safeDownloadOptions(),
      {
        lookup,
        request: async () => {
          loopRequests += 1;
          return { status: 302, headers: { location: "/loop.png" }, data: Buffer.alloc(0) };
        },
      },
    ),
    /redirect limit exceeded/i,
  );
  assert.equal(loopRequests, 6);
});

test("magic and decoded content, not fileName or mimeType claims, define accepted asset types", async (t) => {
  const previousRoot = appConfig.localStorageRoot;
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "smart-kefu-asset-security-"));
  appConfig.localStorageRoot = root;
  t.after(async () => {
    appConfig.localStorageRoot = previousRoot;
    await fsp.rm(root, { recursive: true, force: true });
  });

  assert.deepEqual(await inspectSafeAssetContent(VALID_PNG, "logo.png"), {
    kind: "raster",
    mimeType: "image/png",
    extension: ".png",
    inlineSafe: true,
  });
  assert.deepEqual(await inspectSafeAssetContent(SAFE_PDF, "brief.pdf"), {
    kind: "pdf",
    mimeType: "application/pdf",
    extension: ".pdf",
    inlineSafe: false,
  });
  assert.equal((await inspectSafeAssetContent(Buffer.from("plain operator note", "utf8"), "note.txt")).mimeType, "text/plain");

  for (const [buffer, fileName] of [
    [Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"), "logo.svg"],
    [Buffer.from("<!doctype html><script>alert(1)</script>"), "logo.png"],
    [Buffer.from("<?xml version='1.0'?><root/>"), "note.txt"],
    [Buffer.from("%PDF-1.7\n1 0 obj\n<< /OpenAction 2 0 R /JavaScript (alert) >>\nendobj\n%%EOF\n"), "active.pdf"],
    [Buffer.from("not really a PNG"), "logo.png"],
    [VALID_PNG, "brief.pdf"],
  ]) {
    await assert.rejects(() => inspectSafeAssetContent(buffer, fileName), (error) => error?.getStatus?.() === 400);
  }

  const service = new StorageService();
  await assert.rejects(
    () => service.saveAssetFromBase64({
      ownerType: "customer",
      ownerId: "c1",
      fileName: "logo.png",
      mimeType: "application/pdf",
      base64: VALID_PNG.toString("base64"),
    }),
    (error) => error?.getStatus?.() === 400 && /mime/i.test(error.message),
  );
  assert.deepEqual(fs.readdirSync(root), []);

  const saved = await service.saveAssetFromBase64({
    ownerType: "customer",
    ownerId: "c1",
    fileName: "logo.png",
    mimeType: "image/png",
    base64: VALID_PNG.toString("base64"),
  });
  assert.equal(saved.mimeType, "image/png");
  const read = await service.readLocalAsset(saved.localPath);
  assert.equal(read.mimeType, "image/png");
  assert.equal(read.inlineSafe, true);

  const pdfSaved = await service.saveAssetFromBase64({
    ownerType: "customer",
    ownerId: "c1",
    fileName: "brief.pdf",
    mimeType: "application/pdf",
    base64: SAFE_PDF.toString("base64"),
  });
  const pdfRead = await service.readLocalAsset(pdfSaved.localPath);
  assert.equal(pdfRead.mimeType, "application/pdf");
  assert.equal(pdfRead.inlineSafe, false);
});

test("local asset reads realpath again and reject a storage-internal junction escape", async (t) => {
  const previousRoot = appConfig.localStorageRoot;
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "smart-kefu-storage-root-"));
  const outside = await fsp.mkdtemp(path.join(os.tmpdir(), "smart-kefu-storage-outside-"));
  const outsideFile = path.join(outside, "escape.png");
  const junction = path.join(root, "linked-outside");
  await fsp.writeFile(outsideFile, VALID_PNG);
  await fsp.symlink(outside, junction, "junction");
  appConfig.localStorageRoot = root;
  t.after(async () => {
    appConfig.localStorageRoot = previousRoot;
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(outside, { recursive: true, force: true });
  });

  const service = new StorageService();
  await assert.rejects(
    () => service.readLocalAsset(path.join(junction, "escape.png")),
    (error) => error?.getStatus?.() === 403 && /outside local storage/.test(error.message),
  );
});

function replyFixture() {
  return {
    headers: {},
    body: null,
    header(name, value) {
      this.headers[name] = value;
      return this;
    },
    send(body) {
      this.body = body;
      return body;
    },
  };
}

test("both local-file controllers apply nosniff, sandbox CSP and safe disposition", async () => {
  const assetsReply = replyFixture();
  const assets = new AssetsController({
    readLocalAsset: async () => ({
      stream: Readable.from(Buffer.from("operator note")),
      mimeType: "text/plain",
      sizeBytes: 13,
      fileName: "note.txt",
      inlineSafe: false,
    }),
  });
  await assets.localFile("C:/storage/note.txt", "wx", "conversation", "customer", assetsReply);
  assert.equal(assetsReply.headers["X-Content-Type-Options"], "nosniff");
  assert.match(assetsReply.headers["Content-Security-Policy"], /^sandbox;/);
  assert.match(assetsReply.headers["Content-Disposition"], /^attachment;/);

  const designReply = replyFixture();
  const designJobs = new DesignJobsController({
    readLocalDesignImage: async () => ({
      stream: Readable.from(VALID_PNG),
      mimeType: "image/png",
      sizeBytes: VALID_PNG.length,
      fileName: "candidate.png",
      inlineSafe: true,
    }),
  });
  await designJobs.localImageFile("job", "candidate", "wx", "conversation", "customer", designReply);
  assert.equal(designReply.headers["X-Content-Type-Options"], "nosniff");
  assert.match(designReply.headers["Content-Security-Policy"], /^sandbox;/);
  assert.match(designReply.headers["Content-Disposition"], /^inline;/);

  const pdfReply = replyFixture();
  const pdfAssets = new AssetsController({
    readLocalAsset: async () => ({
      stream: Readable.from(SAFE_PDF),
      mimeType: "application/pdf",
      sizeBytes: SAFE_PDF.length,
      fileName: "brief.pdf",
      inlineSafe: false,
    }),
  });
  await pdfAssets.localFile("C:/storage/brief.pdf", "wx", "conversation", "customer", pdfReply);
  assert.match(pdfReply.headers["Content-Disposition"], /^attachment;/);
});
