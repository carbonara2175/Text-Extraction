// PDF.js本体とWorkerはCDNから読み込みます。PDFファイル自体がCDNへ送られることはありません。
import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

const elements = {
  input: document.querySelector("#file-input"), dropZone: document.querySelector("#drop-zone"),
  fileInfo: document.querySelector("#file-info"), fileName: document.querySelector("#file-name"),
  extract: document.querySelector("#extract-button"), separators: document.querySelector("#show-separators"),
  status: document.querySelector("#status"), result: document.querySelector("#result-text"),
  copy: document.querySelector("#copy-button"), clear: document.querySelector("#clear-button"),
  pageCount: document.querySelector("#page-count"), toast: document.querySelector("#toast")
};

let selectedFile = null;
let extractedPages = [];
let toastTimer;

function setStatus(message = "", isError = false, isLoading = false) {
  elements.status.textContent = message;
  elements.status.className = `status${isError ? " error" : ""}${isLoading ? " loading" : ""}`;
}

// 拡張子とMIME typeを確認し、PDF以外を分かりやすく拒否します。
function isPdf(file) {
  return file && (file.type === "application/pdf" || (/\.pdf$/i.test(file.name) && !file.type));
}

function selectFile(file) {
  if (!isPdf(file)) {
    setStatus("PDF形式のファイルを選択してください。", true);
    return;
  }
  selectedFile = file;
  extractedPages = [];
  elements.fileName.textContent = file.name;
  elements.fileInfo.hidden = false;
  elements.extract.disabled = false;
  elements.result.value = "";
  elements.copy.disabled = true;
  elements.pageCount.hidden = true;
  setStatus("PDFを選択しました。「文章を抽出」を押してください。");
}

elements.input.addEventListener("change", () => {
  if (elements.input.files[0]) selectFile(elements.input.files[0]);
});

elements.dropZone.addEventListener("click", (event) => {
  if (event.target.tagName !== "LABEL") elements.input.click();
});
elements.dropZone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); elements.input.click(); }
});
["dragenter", "dragover"].forEach((name) => elements.dropZone.addEventListener(name, (event) => {
  event.preventDefault(); elements.dropZone.classList.add("drag-over");
}));
["dragleave", "drop"].forEach((name) => elements.dropZone.addEventListener(name, (event) => {
  event.preventDefault(); elements.dropZone.classList.remove("drag-over");
}));
elements.dropZone.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files[0];
  if (file) selectFile(file);
});

// PDF.jsの文字アイテムを行単位に近い形へ整えます。
function textItemsToString(items) {
  let text = "";
  let previousY = null;
  for (const item of items) {
    const y = Math.round(item.transform[5]);
    if (previousY !== null && Math.abs(y - previousY) > 4) text += "\n";
    else if (text && !text.endsWith("\n") && !item.str.startsWith(" ")) text += " ";
    text += item.str;
    if (item.hasEOL) text += "\n";
    previousY = y;
  }
  return text.trim();
}

function renderResult() {
  elements.result.value = extractedPages.map((text, index) => {
    const separator = elements.separators.checked ? `--- ${index + 1}ページ目 ---\n\n` : "";
    return separator + text;
  }).join("\n\n");
  elements.copy.disabled = !elements.result.value.trim();
}

elements.extract.addEventListener("click", async () => {
  if (!selectedFile) return;
  elements.extract.disabled = true;
  elements.copy.disabled = true;
  setStatus("文章を抽出しています…", false, true);
  try {
    // ArrayBufferをPDF.jsへ渡すだけなので、ファイルはブラウザの外へ出ません。
    const data = await selectedFile.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    extractedPages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      setStatus(`${pageNumber} / ${pdf.numPages} ページを処理しています…`, false, true);
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      extractedPages.push(textItemsToString(content.items));
    }
    if (!extractedPages.some((page) => page.trim())) {
      extractedPages = [];
      elements.result.value = "";
      elements.pageCount.hidden = true;
      setStatus("このPDFから文字を取得できませんでした。スキャンPDFや画像PDFの可能性があります。", true);
      return;
    }
    renderResult();
    elements.pageCount.textContent = `${pdf.numPages}ページ`;
    elements.pageCount.hidden = false;
    setStatus(`${pdf.numPages}ページの文章を抽出しました。`);
  } catch (error) {
    console.error(error);
    extractedPages = [];
    elements.result.value = "";
    setStatus("PDFを読み込めませんでした。ファイルが壊れていないか確認してください。", true);
  } finally {
    elements.extract.disabled = !selectedFile;
  }
});

elements.separators.addEventListener("change", () => {
  // 抽出済みのページ配列から再描画するため、PDFを再読込する必要はありません。
  if (extractedPages.length) renderResult();
});

elements.result.addEventListener("input", () => { elements.copy.disabled = !elements.result.value.trim(); });

elements.copy.addEventListener("click", async () => {
  if (!elements.result.value) return;
  try {
    await navigator.clipboard.writeText(elements.result.value);
    elements.toast.textContent = "コピーしました";
  } catch {
    // file://などClipboard APIが使えない環境向けの代替手段です。
    elements.result.select();
    const succeeded = document.execCommand("copy");
    elements.toast.textContent = succeeded ? "コピーしました" : "コピーできませんでした。文章を選択してコピーしてください。";
  }
  elements.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 2200);
});

elements.clear.addEventListener("click", () => {
  selectedFile = null;
  extractedPages = [];
  elements.input.value = "";
  elements.fileInfo.hidden = true;
  elements.fileName.textContent = "";
  elements.result.value = "";
  elements.extract.disabled = true;
  elements.copy.disabled = true;
  elements.pageCount.hidden = true;
  elements.separators.checked = true;
  setStatus();
});
