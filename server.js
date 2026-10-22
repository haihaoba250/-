"use strict";

const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const PORT = Number(process.env.PORT) || 4318;
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");
const APP_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";
const MEDIA_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const MTOP_APP_KEY = "12574478";
const ITEM_CACHE_MS = 5 * 60 * 1000;
const MAX_MEDIA_ITEMS = 40;
const MAX_MEDIA_BYTES = 180 * 1024 * 1024;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const itemCache = new Map();

class AppError extends Error {
  constructor(message, status = 400, code = "BAD_REQUEST") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function isSupportedListingHost(hostname) {
  const host = hostname.toLowerCase();
  return host === "m.tb.cn" || host === "goofish.com" || host.endsWith(".goofish.com");
}

function isAllowedMediaHost(hostname) {
  const host = hostname.toLowerCase();
  return (
    host === "alicdn.com" ||
    host.endsWith(".alicdn.com") ||
    host === "taobao.com" ||
    host.endsWith(".taobao.com")
  );
}

function extractSharedUrl(input) {
  const value = String(input || "").trim();
  if (!value) {
    throw new AppError("请先粘贴闲鱼分享链接或文案。");
  }

  if (/^\d{6,22}$/.test(value)) {
    return { itemId: value, sourceUrl: null };
  }

  const match = value.match(/https?:\/\/[^\s<>"']+/i);
  if (!match) {
    throw new AppError("没有找到有效链接，请粘贴完整的闲鱼分享文案。");
  }

  const cleaned = match[0].replace(/[，。；;、）)\]】」』]+$/u, "");
  let parsed;
  try {
    parsed = new URL(cleaned);
  } catch {
    throw new AppError("链接格式不正确，请重新复制闲鱼分享文案。");
  }

  if (!isSupportedListingHost(parsed.hostname)) {
    throw new AppError("目前仅支持闲鱼公开商品链接。", 400, "UNSUPPORTED_HOST");
  }

  return { url: parsed.toString(), itemId: parseItemId(parsed) };
}

function parseItemId(url) {
  const keys = ["itemId", "id", "item_id"];
  for (const key of keys) {
    const value = url.searchParams.get(key);
    if (value && /^\d{6,22}$/.test(value)) {
      return value;
    }
  }

  const pathMatch = url.pathname.match(/(?:item|detail)\/?(\d{6,22})/i);
  return pathMatch ? pathMatch[1] : null;
}

async function resolveItemId(input) {
  const extracted = extractSharedUrl(input);
  if (extracted.itemId) {
    return { itemId: extracted.itemId, sourceUrl: extracted.url || null };
  }

  const source = new URL(extracted.url);
  if (source.hostname.toLowerCase() !== "m.tb.cn") {
    throw new AppError("无法从这个闲鱼链接中识别商品编号。", 422, "ITEM_ID_MISSING");
  }

  let response;
  try {
    response = await fetch(source, {
      redirect: "follow",
      headers: {
        "user-agent": APP_USER_AGENT,
        accept: "text/html,application/xhtml+xml"
      },
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    throw new AppError("短链接读取失败，请稍后重试。", 502, "SHORT_LINK_FAILED");
  }

  if (!response.ok) {
    throw new AppError("短链接已失效或暂时无法访问。", 422, "SHORT_LINK_UNAVAILABLE");
  }

  const html = await response.text();
  const directItemId = parseItemId(new URL(response.url));
  if (directItemId) {
    return { itemId: directItemId, sourceUrl: response.url };
  }

  const targetMatch = html.match(/(?:var\s+)?url\s*=\s*['"]([^'"]*goofish\.com[^'"]*)['"]/i);
  if (!targetMatch) {
    throw new AppError("该分享页没有指向可读取的商品，请确认商品仍然公开。", 422, "TARGET_NOT_FOUND");
  }

  let targetUrl;
  try {
    targetUrl = new URL(targetMatch[1].replaceAll("\\/", "/").replaceAll("&amp;", "&"));
  } catch {
    throw new AppError("商品目标地址解析失败。", 422, "TARGET_INVALID");
  }

  const itemId = parseItemId(targetUrl);
  if (!itemId) {
    throw new AppError("分享页中没有找到商品编号。", 422, "ITEM_ID_MISSING");
  }

  return { itemId, sourceUrl: targetUrl.toString() };
}

function getSetCookies(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const value = headers.get("set-cookie");
  return value ? [value] : [];
}

class MtopClient {
  constructor() {
    this.cookies = new Map();
    this.token = "";
    this.tokenExpiresAt = 0;
    this.refreshPromise = null;
  }

  mergeCookies(response) {
    for (const rawCookie of getSetCookies(response.headers)) {
      const pair = rawCookie.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator > 0) {
        this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
    }

    const tokenCookie = this.cookies.get("_m_h5_tk") || "";
    this.token = tokenCookie.split("_")[0] || "";
  }

  cookieHeader() {
    return Array.from(this.cookies, ([name, value]) => `${name}=${value}`).join("; ");
  }

  requestUrl(api, version, dataString, timestamp, token) {
    const payload = [
      token,
      timestamp,
      MTOP_APP_KEY,
      dataString
    ].join("&");
    const sign = crypto.createHash("md5").update(payload).digest("hex");
    const params = new URLSearchParams({
      jsv: "2.7.2",
      appKey: MTOP_APP_KEY,
      t: String(timestamp),
      sign,
      api,
      v: version,
      type: "originaljson",
      dataType: "json",
      timeout: "20000",
      data: dataString
    });
    return `https://h5api.m.goofish.com/h5/${api}/${version}/?${params.toString()}`;
  }

  async fetchMtop(api, version, dataString, token) {
    const timestamp = Date.now();
    const response = await fetch(this.requestUrl(api, version, dataString, timestamp, token), {
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
        cookie: this.cookieHeader(),
        referer: "https://h5.m.goofish.com/",
        "user-agent": APP_USER_AGENT,
        "x-requested-with": "XMLHttpRequest"
      },
      signal: AbortSignal.timeout(20000)
    });

    this.mergeCookies(response);
    if (!response.ok) {
      throw new AppError("闲鱼商品接口暂时不可用，请稍后重试。", 502, "MTOP_HTTP_ERROR");
    }

    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new AppError("闲鱼返回了无法识别的数据，请稍后重试。", 502, "MTOP_INVALID_JSON");
    }
  }

  async refreshToken() {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      this.cookies.clear();
      this.token = "";
      await this.fetchMtop(
        "mtop.taobao.idle.awesome.detail",
        "1.0",
        JSON.stringify({ itemId: "000000000000" }),
        ""
      );

      if (!this.token) {
        throw new AppError("无法建立闲鱼商品数据连接，请稍后重试。", 502, "TOKEN_MISSING");
      }
      this.tokenExpiresAt = Date.now() + 45 * 60 * 1000;
    })().finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  async request(api, version, data) {
    if (!this.token || Date.now() >= this.tokenExpiresAt) {
      await this.refreshToken();
    }

    const dataString = JSON.stringify(data);
    let result = await this.fetchMtop(api, version, dataString, this.token);
    let ret = Array.isArray(result.ret) ? result.ret.join(" ") : "";

    if (/TOKEN_EMPTY|TOKEN_EXOIRED|TOKEN_EXPIRED|ILLEGAL_ACCESS/i.test(ret)) {
      await this.refreshToken();
      result = await this.fetchMtop(api, version, dataString, this.token);
      ret = Array.isArray(result.ret) ? result.ret.join(" ") : "";
    }

    if (!/SUCCESS/i.test(ret)) {
      if (/ITEM_NOT_FOUND|ITEM_DELETED|NOT_EXIST/i.test(ret)) {
        throw new AppError("商品不存在、已下架或当前不可公开查看。", 404, "ITEM_UNAVAILABLE");
      }
      throw new AppError("闲鱼未能返回这个商品的公开详情。", 502, "MTOP_ITEM_ERROR");
    }

    return result.data;
  }
}

const mtopClient = new MtopClient();

function canonicalMediaUrl(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  try {
    const url = new URL(value.replaceAll("\\/", "/"));
    if (!isAllowedMediaHost(url.hostname)) {
      return "";
    }
    url.protocol = "https:";
    return url.toString();
  } catch {
    return "";
  }
}

function getComponents(data) {
  const sections = data?.flowData?.body?.sections;
  if (!Array.isArray(sections)) {
    return [];
  }
  return sections.flatMap((section) =>
    Array.isArray(section?.components) ? section.components : []
  );
}

function parseItemData(data, itemId) {
  const components = getComponents(data);
  const images = [];
  const seenImages = new Set();
  let video = null;
  let description = "";
  let descriptionWithTopic = "";
  let title = "";
  let price = "";

  for (const component of components) {
    const item = component?.data;
    if (!item || typeof item !== "object") {
      continue;
    }

    if (!title && typeof item.title === "string") {
      title = item.title.trim();
    }
    if (!price && item.soldPrice != null) {
      price = String(item.soldPrice);
    }
    if (typeof item.descriptionInfo === "string" && item.descriptionInfo.trim()) {
      description = item.descriptionInfo.trim();
    }
    if (component.render === "Basic_Native_desc_text_1" && typeof item.desc === "string") {
      descriptionWithTopic = item.desc.trim();
    }

    if (Array.isArray(item.imageInfos)) {
      for (const image of item.imageInfos) {
        const mediaUrl = canonicalMediaUrl(image?.url);
        if (!mediaUrl) {
          continue;
        }
        const key = new URL(mediaUrl).pathname;
        if (seenImages.has(key)) {
          continue;
        }
        seenImages.add(key);
        images.push({
          url: mediaUrl,
          width: Number(image.widthSize) || null,
          height: Number(image.heightSize) || null
        });
      }
    }

    if (!video && item.videoPlayInfo && typeof item.videoPlayInfo === "object") {
      const info = item.videoPlayInfo;
      const playUrl =
        canonicalMediaUrl(info.playUrl) ||
        canonicalMediaUrl(info.sd480pUrl) ||
        canonicalMediaUrl(info.ld320pUrl);
      if (playUrl) {
        video = {
          url: playUrl,
          cover: canonicalMediaUrl(info.url),
          width: Number(info.widthSize) || null,
          height: Number(info.heightSize) || null
        };
      }
    }
  }

  if (!description) {
    description = descriptionWithTopic;
  }
  if (!title && description) {
    title = description.split(/\r?\n/, 1)[0].slice(0, 54);
  }
  if (!title) {
    title = `闲鱼商品 ${itemId}`;
  }

  if (images.length > MAX_MEDIA_ITEMS) {
    throw new AppError("商品图片数量异常，已停止处理。", 422, "TOO_MANY_MEDIA");
  }

  return {
    itemId,
    title,
    price,
    description,
    images,
    video,
    mediaCount: images.length + (video ? 1 : 0),
    fetchedAt: new Date().toISOString()
  };
}

async function getItemDetails(input) {
  const { itemId, sourceUrl } = await resolveItemId(input);
  const cached = itemCache.get(itemId);
  if (cached && Date.now() - cached.createdAt < ITEM_CACHE_MS) {
    return { ...cached.value, sourceUrl };
  }

  const data = await mtopClient.request(
    "mtop.taobao.idle.awesome.detail",
    "1.0",
    { itemId }
  );
  const item = parseItemData(data, itemId);

  if (!item.description && !item.images.length && !item.video) {
    throw new AppError("没有从该商品中读取到可保存的图片、视频或描述。", 422, "NO_ASSET");
  }

  itemCache.set(itemId, { createdAt: Date.now(), value: item });
  if (itemCache.size > 100) {
    const oldestKey = itemCache.keys().next().value;
    itemCache.delete(oldestKey);
  }
  return { ...item, sourceUrl };
}

function validateMediaUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new AppError("媒体地址无效。");
  }
  if (url.protocol !== "https:" || !isAllowedMediaHost(url.hostname)) {
    throw new AppError("仅允许下载该商品中的闲鱼媒体资源。", 403, "MEDIA_HOST_DENIED");
  }
  return url;
}

function cleanFilename(value, fallback = "download") {
  const cleaned = String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 90);
  return cleaned || fallback;
}

function contentDisposition(filename) {
  const safe = cleanFilename(filename);
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

function extensionFromContentType(contentType, fallback = ".bin") {
  const normalized = String(contentType || "").split(";", 1)[0].trim().toLowerCase();
  const map = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm"
  };
  return map[normalized] || fallback;
}

function extensionFromUrl(value, fallback = ".bin") {
  try {
    const ext = path.extname(new URL(value).pathname).toLowerCase();
    return /^\.[a-z0-9]{2,5}$/.test(ext) ? ext : fallback;
  } catch {
    return fallback;
  }
}

async function fetchRemoteMedia(url) {
  const response = await fetch(url, {
    headers: {
      accept: "image/jpeg,image/png,video/mp4,video/*;q=0.9,*/*;q=0.8",
      referer: "https://h5.m.goofish.com/",
      "user-agent": MEDIA_USER_AGENT
    },
    redirect: "follow",
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    throw new AppError("媒体文件读取失败。", 502, "MEDIA_FETCH_FAILED");
  }
  const finalUrl = new URL(response.url);
  if (!isAllowedMediaHost(finalUrl.hostname)) {
    throw new AppError("媒体重定向到了不受支持的地址。", 403, "MEDIA_REDIRECT_DENIED");
  }

  const length = Number(response.headers.get("content-length"));
  if (length > MAX_MEDIA_BYTES) {
    throw new AppError("单个媒体文件超过 180 MB，已停止处理。", 413, "MEDIA_TOO_LARGE");
  }
  return response;
}

async function proxyMedia(req, res, itemId, kind, index, downloadName) {
  if (!/^\d{6,22}$/.test(itemId)) {
    throw new AppError("商品编号无效。");
  }
  const item = await getItemDetails(itemId);
  let mediaUrl = "";

  if (kind === "video") {
    mediaUrl = item.video?.url || "";
  } else if (kind === "image" && /^\d{1,3}$/.test(index)) {
    mediaUrl = item.images[Number(index)]?.url || "";
  }
  if (!mediaUrl) {
    throw new AppError("没有找到对应的商品媒体。", 404, "MEDIA_NOT_FOUND");
  }

  const url = validateMediaUrl(mediaUrl);
  let upstream;
  try {
    upstream = await fetchRemoteMedia(url);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError("媒体连接失败，请稍后重试。", 502, "MEDIA_NETWORK_ERROR");
  }

  let bytes = 0;
  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      bytes += chunk.length;
      if (bytes > MAX_MEDIA_BYTES) {
        callback(new AppError("媒体文件过大，已停止下载。", 413, "MEDIA_TOO_LARGE"));
        return;
      }
      callback(null, chunk);
    }
  });

  const contentType = upstream.headers.get("content-type") || "application/octet-stream";
  const fallbackExt = contentType.startsWith("video/") ? ".mp4" : ".jpg";
  const extension = extensionFromContentType(contentType, extensionFromUrl(url, fallbackExt));
  const requestedName = cleanFilename(downloadName, `media${extension}`);
  const filename = /\.[a-z0-9]{2,5}$/i.test(requestedName)
    ? requestedName
    : `${requestedName}${extension}`;

  res.writeHead(200, {
    "content-type": contentType,
    "cache-control": "private, max-age=3600",
    "content-disposition": contentDisposition(filename),
    "x-content-type-options": "nosniff",
    ...(upstream.headers.get("content-length")
      ? { "content-length": upstream.headers.get("content-length") }
      : {})
  });

  try {
    await pipeline(Readable.fromWeb(upstream.body), limiter, res);
  } catch (error) {
    if (!res.headersSent) {
      throw error;
    }
    res.destroy(error);
  }
}

function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(body);
}

function getRequestUrl(req) {
  return new URL(req.url, `http://${req.headers.host || "localhost"}`);
}

async function handleApi(req, res) {
  const requestUrl = getRequestUrl(req);
  const pathname = requestUrl.pathname;

  if (pathname === "/api/health") {
    sendJson(res, 200, { app: "xianyu-asset-saver", ok: true });
    return true;
  }

  if (req.method !== "GET") {
    sendJson(res, 405, { error: "仅支持 GET 请求。", code: "METHOD_NOT_ALLOWED" });
    return true;
  }

  if (pathname === "/api/item") {
    const input = requestUrl.searchParams.get("url") || "";
    const item = await getItemDetails(input);
    sendJson(res, 200, item);
    return true;
  }

  if (pathname === "/api/media") {
    const itemId = requestUrl.searchParams.get("itemId") || "";
    const kind = requestUrl.searchParams.get("kind") || "";
    const index = requestUrl.searchParams.get("index") || "";
    const name = requestUrl.searchParams.get("name") || "media";
    await proxyMedia(req, res, itemId, kind, index, name);
    return true;
  }

  return false;
}

function serveStatic(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { error: "仅支持 GET 请求。", code: "METHOD_NOT_ALLOWED" });
    return;
  }

  const requestUrl = getRequestUrl(req);
  let pathname;
  try {
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    sendJson(res, 400, { error: "请求路径无效。", code: "BAD_PATH" });
    return;
  }
  if (pathname === "/") {
    pathname = "/index.html";
  }

  const filePath = path.join(PUBLIC_DIR, pathname);
  const relative = path.relative(PUBLIC_DIR, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    sendJson(res, 403, { error: "禁止访问该路径。", code: "FORBIDDEN" });
    return;
  }

  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) {
      sendJson(res, 404, { error: "页面不存在。", code: "NOT_FOUND" });
      return;
    }

    const contentType = mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    const isShellFile = /\.(?:css|js|svg|webmanifest)$/i.test(filePath);
    res.writeHead(200, {
      "content-type": contentType,
      "content-length": stat.size,
      "cache-control": isShellFile ? "public, max-age=3600" : "no-cache",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY",
      "permissions-policy": "camera=(), microphone=(), geolocation=()"
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(filePath)
      .on("error", () => {
        if (!res.headersSent) {
          sendJson(res, 500, { error: "文件读取失败。", code: "FILE_READ_FAILED" });
        } else {
          res.destroy();
        }
      })
      .pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("x-request-id", crypto.randomUUID());

  try {
    if (req.url?.startsWith("/api/")) {
      const handled = await handleApi(req, res);
      if (!handled) {
        sendJson(res, 404, { error: "接口不存在。", code: "API_NOT_FOUND" });
      }
      return;
    }
    serveStatic(req, res);
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    const message =
      error instanceof AppError
        ? error.message
        : "服务遇到了意外问题，请稍后重试。";
    const code = error instanceof AppError ? error.code : "INTERNAL_ERROR";
    if (!res.headersSent) {
      sendJson(res, status, { error: message, code });
    } else {
      res.destroy(error instanceof Error ? error : undefined);
    }
    if (!(error instanceof AppError)) {
      console.error(error);
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`闲鱼无水印下载已启动：http://localhost:${PORT}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
