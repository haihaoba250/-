"use strict";

const elements = {
  input: document.querySelector("#shareInput"),
  parseButton: document.querySelector("#parseButton"),
  pasteButton: document.querySelector("#pasteButton"),
  installButton: document.querySelector("#installButton"),
  loadingView: document.querySelector("#loadingView"),
  loadingTitle: document.querySelector("#loadingTitle"),
  errorView: document.querySelector("#errorView"),
  errorMessage: document.querySelector("#errorMessage"),
  retryButton: document.querySelector("#retryButton"),
  resultView: document.querySelector("#resultView"),
  productCover: document.querySelector("#productCover"),
  productTitle: document.querySelector("#productTitle"),
  productPrice: document.querySelector("#productPrice"),
  itemNumber: document.querySelector("#itemNumber"),
  assetCounts: document.querySelector("#assetCounts"),
  newLinkButton: document.querySelector("#newLinkButton"),
  saveAllButton: document.querySelector("#saveAllButton"),
  saveMediaLabel: document.querySelector("#saveMediaLabel, #bundleSizeLabel"),
  copyDescriptionButton: document.querySelector("#copyDescriptionButton"),
  descriptionCopySmall: document.querySelector("#descriptionCopySmall"),
  imageGallery: document.querySelector("#imageGallery"),
  imageCount: document.querySelector("#imageCount"),
  videoSection: document.querySelector("#videoSection"),
  productVideo: document.querySelector("#productVideo"),
  videoDownload: document.querySelector("#videoDownload"),
  descriptionText: document.querySelector("#descriptionText"),
  toastRegion: document.querySelector("#toastRegion")
};

const state = {
  item: null,
  lastInput: "",
  deferredInstallPrompt: null,
  parseRequest: null
};

function extractSharedUrl(input) {
  const value = String(input || "").trim();
  if (!value) {
    return "";
  }
  const match = value.match(/https?:\/\/[^\s<>"']+/i);
  return match ? match[0].replace(/[，。；;、）)\]】」』]+$/u, "") : "";
}

function showToast(message, type = "") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`.trim();
  toast.textContent = message;
  elements.toastRegion.append(toast);
  window.setTimeout(() => {
    toast.classList.add("leaving");
    window.setTimeout(() => toast.remove(), 190);
  }, 3400);
}

function setLoading(isLoading) {
  elements.parseButton.disabled = isLoading;
  elements.parseButton.querySelector("span").textContent = isLoading
    ? "正在解析…"
    : "解析这件商品";
  elements.loadingView.hidden = !isLoading;
  if (isLoading) {
    elements.errorView.hidden = true;
  }
}

function showError(message) {
  elements.errorMessage.textContent = message;
  elements.errorView.hidden = false;
  elements.resultView.hidden = true;
}

async function parseListing(rawInput) {
  const input = String(rawInput || "").trim();
  const sharedUrl = extractSharedUrl(input);
  if (!sharedUrl && !/^\d{6,22}$/.test(input)) {
    showError("没有找到有效链接。请粘贴完整的闲鱼分享文案，或直接输入商品编号。");
    elements.input.focus();
    return;
  }

  if (state.parseRequest) {
    state.parseRequest.abort();
  }
  state.parseRequest = new AbortController();
  state.lastInput = input;
  localStorage.setItem("xianyu-last-input", input);
  setLoading(true);
  elements.resultView.hidden = true;
  elements.loadingTitle.textContent = "找到商品，提取素材中…";

  try {
    const response = await fetch(`/api/item?url=${encodeURIComponent(input)}`, {
      signal: state.parseRequest.signal,
      headers: { accept: "application/json" }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "商品解析失败，请稍后重试。");
    }
    state.item = payload;
    renderItem(payload);
  } catch (error) {
    if (error.name !== "AbortError") {
      showError(error.message || "网络连接失败，请稍后重试。");
    }
  } finally {
    setLoading(false);
    state.parseRequest = null;
  }
}

function makeMediaDownloadUrl(itemId, kind, index, filename) {
  const params = new URLSearchParams({
    itemId,
    kind,
    index: String(index),
    name: filename
  });
  return `/api/media?${params.toString()}`;
}

function baseFilename(title) {
  return String(title || "闲鱼商品")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 46) || "闲鱼商品";
}

function createCount(label, amount) {
  const span = document.createElement("span");
  const dot = document.createElement("i");
  span.append(dot, document.createTextNode(`${amount} ${label}`));
  return span;
}

function renderItem(item) {
  elements.errorView.hidden = true;
  elements.resultView.hidden = false;
  elements.productTitle.textContent = item.title;
  elements.productCover.src = item.images[0]?.url || item.video?.cover || "";
  elements.productCover.alt = `${item.title} 商品封面`;
  elements.productPrice.textContent = item.price || "";
  elements.productPrice.hidden = !item.price;
  elements.itemNumber.textContent = `ID ${item.itemId}`;

  elements.assetCounts.replaceChildren();
  elements.assetCounts.append(createCount("张图片", item.images.length));
  elements.assetCounts.append(createCount("个视频", item.video ? 1 : 0));
  elements.assetCounts.append(createCount("段描述", item.description ? 1 : 0));
  elements.saveMediaLabel.textContent = [
    item.images.length ? `${item.images.length} 张原图` : "",
    item.video ? "1 个原视频" : "",
    "一键保存"
  ].filter(Boolean).join(" · ");

  renderImages(item);
  renderVideo(item);
  elements.descriptionText.textContent = item.description || "";
  elements.copyDescriptionButton.disabled = !item.description;
  elements.descriptionCopySmall.disabled = !item.description;

  requestAnimationFrame(() => {
    elements.resultView.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function renderImages(item) {
  elements.imageGallery.replaceChildren();
  elements.imageCount.textContent = item.images.length ? `· ${item.images.length}` : "";

  const title = baseFilename(item.title);
  item.images.forEach((image, index) => {
    const card = document.createElement("div");
    card.className = "media-card";

    const imageElement = document.createElement("img");
    imageElement.src = image.url;
    imageElement.alt = `${item.title} 图片 ${index + 1}`;
    imageElement.loading = index < 6 ? "eager" : "lazy";
    imageElement.decoding = "async";
    imageElement.referrerPolicy = "no-referrer";

    const indexLabel = document.createElement("span");
    indexLabel.className = "media-index";
    indexLabel.textContent = String(index + 1).padStart(2, "0");

    const link = document.createElement("a");
    link.className = "media-save";
    link.href = makeMediaDownloadUrl(
      item.itemId,
      "image",
      index,
      `${title}_${String(index + 1).padStart(2, "0")}.jpg`
    );
    link.download = "";
    link.title = `保存第 ${index + 1} 张图片`;
    link.setAttribute("aria-label", `保存第 ${index + 1} 张图片`);
    link.innerHTML =
      '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.5v9m0 0 3.4-3.4M10 12.5 6.6 9.1M4 16.5h12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    link.addEventListener("click", () => {
      showToast(`正在保存第 ${index + 1} 张图片`);
    });

    card.append(imageElement, indexLabel, link);
    elements.imageGallery.append(card);
  });
}

function renderVideo(item) {
  const video = item.video;
  elements.videoSection.hidden = !video;
  if (!video) {
    elements.productVideo.removeAttribute("src");
    elements.productVideo.removeAttribute("poster");
    elements.videoDownload.removeAttribute("href");
    return;
  }

  elements.productVideo.src = video.url;
  if (video.cover) {
    elements.productVideo.poster = video.cover;
  }
  elements.videoDownload.href = makeMediaDownloadUrl(
    item.itemId,
    "video",
    0,
    `${baseFilename(item.title)}_原视频.mp4`
  );
}

async function copyText(text) {
  if (!text) {
    throw new Error("这件商品没有公开描述文字。");
  }

  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.append(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("浏览器未允许复制，请手动选择描述文字。");
  }
}

async function copyDescription(showSuccess = true) {
  if (!state.item?.description) {
    showToast("这件商品没有公开描述文字。", "error");
    return false;
  }
  try {
    await copyText(state.item.description);
    if (showSuccess) {
      showToast("商品描述已复制");
    }
    return true;
  } catch (error) {
    showToast(error.message || "复制失败，请手动选择描述文字。", "error");
    return false;
  }
}

function triggerMediaDownload(downloadUrl) {
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = "";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

async function saveAll() {
  if (!state.item) {
    return;
  }

  const title = baseFilename(state.item.title);
  const downloads = state.item.images.map((image, index) => ({
    url: makeMediaDownloadUrl(
      state.item.itemId,
      "image",
      index,
      `${title}_${String(index + 1).padStart(2, "0")}.jpg`
    ),
    label: `图片 ${index + 1}`
  }));
  if (state.item.video) {
    downloads.push({
      url: makeMediaDownloadUrl(
        state.item.itemId,
        "video",
        0,
        `${title}_原视频.mp4`
      ),
      label: "视频"
    });
  }
  if (!downloads.length) {
    showToast("这件商品没有可下载的图片或视频。", "error");
    return;
  }

  elements.saveAllButton.disabled = true;
  const originalLabel = elements.saveMediaLabel.textContent;

  for (let index = 0; index < downloads.length; index += 1) {
    elements.saveMediaLabel.textContent =
      `正在保存 ${index + 1}/${downloads.length} · ${downloads[index].label}`;
    triggerMediaDownload(downloads[index].url);
    if (index < downloads.length - 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 320));
    }
  }

  showToast(`已一键发起 ${downloads.length} 个文件下载`);

  window.setTimeout(() => {
    elements.saveAllButton.disabled = false;
    elements.saveMediaLabel.textContent = originalLabel;
  }, 1500);
}

function resetView() {
  state.item = null;
  elements.resultView.hidden = true;
  elements.errorView.hidden = true;
  elements.productVideo.pause();
  elements.input.value = "";
  elements.input.focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) {
      showToast("剪贴板中没有文字。", "error");
      return;
    }
    elements.input.value = text;
    elements.input.focus();
    if (extractSharedUrl(text)) {
      showToast("已粘贴，正在解析…");
      await parseListing(text);
    }
  } catch {
    elements.input.focus();
    showToast("浏览器未允许读取剪贴板，请长按输入框粘贴。", "error");
  }
}

function handleInstall() {
  if (state.deferredInstallPrompt) {
    state.deferredInstallPrompt.prompt();
    state.deferredInstallPrompt.userChoice.finally(() => {
      state.deferredInstallPrompt = null;
      elements.installButton.hidden = true;
    });
    return;
  }

  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
  if (isStandalone) {
    showToast("当前已经在独立应用模式中运行。");
  } else if (isIOS) {
    showToast("Safari：点“分享”按钮，再选“添加到主屏幕”。");
  } else {
    showToast("请使用浏览器菜单中的“安装应用”或“添加到主屏幕”。");
  }
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.deferredInstallPrompt = event;
  elements.installButton.hidden = false;
});

window.addEventListener("appinstalled", () => {
  state.deferredInstallPrompt = null;
  elements.installButton.hidden = true;
  showToast("应用已安装");
});

elements.parseButton.addEventListener("click", () => parseListing(elements.input.value));
elements.pasteButton.addEventListener("click", pasteFromClipboard);
elements.retryButton.addEventListener("click", () => parseListing(state.lastInput || elements.input.value));
elements.newLinkButton.addEventListener("click", resetView);
elements.copyDescriptionButton.addEventListener("click", () => copyDescription());
elements.descriptionCopySmall.addEventListener("click", () => copyDescription());
elements.saveAllButton.addEventListener("click", saveAll);
elements.installButton.addEventListener("click", handleInstall);

elements.input.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    parseListing(elements.input.value);
  }
});

elements.input.addEventListener("paste", () => {
  window.setTimeout(() => {
    if (extractSharedUrl(elements.input.value)) {
      showToast("链接已识别，按“解析这件商品”继续");
    }
  }, 30);
});

const savedInput = localStorage.getItem("xianyu-last-input");
const queryUrl = new URLSearchParams(window.location.search).get("url");
if (queryUrl) {
  elements.input.value = queryUrl;
  parseListing(queryUrl);
} else if (savedInput) {
  elements.input.value = savedInput;
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // The app remains fully usable when service workers are unavailable.
    });
  });
}

if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
  elements.installButton.hidden = false;
}
