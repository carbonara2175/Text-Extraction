// PDF.js本体とWorkerはCDNから読み込みます。PDFファイル自体がCDNへ送られることはありません。
import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

const elements = {
  input: document.querySelector("#file-input"), dropZone: document.querySelector("#drop-zone"),
  fileInfo: document.querySelector("#file-info"), fileName: document.querySelector("#file-name"),
  extract: document.querySelector("#extract-button"), format: document.querySelector("#format-text"),
  separators: document.querySelector("#show-separators"),
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
    // 座標の変化とhasEOLが同じ行末を示す場合でも、改行は1個だけ追加します。
    if (previousY !== null && Math.abs(y - previousY) > 4 && !text.endsWith("\n")) text += "\n";
    else if (text && !text.endsWith("\n") && !item.str.startsWith(" ")) text += " ";
    text += item.str;
    if (item.hasEOL && !text.endsWith("\n")) text += "\n";
    previousY = y;
  }
  return text.trim();
}

// 見た目の折り返しではなく、文書構造として残すべき行の始まりを判定します。
function startsNewSection(line) {
  return /^(?:[（(][^）)]+[）)]|附\s*則|第[0-9０-９一二三四五六七八九十百千]+(?:条|項|節|章|編)?(?:[\s　]|$)|[0-9０-９一二三四五六七八九十]+[.．、)）\s　]|[・●○■□◆◇▶▷※]|[-*]\s+)/.test(line);
}

function needsSpace(left, right) {
  // 英数字の単語だけは、行をつなぐ際に単語間の空白を補います。日本語には空白を入れません。
  return /[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right) ? " " : "";
}

// PDF上の折り返しをつなぎ、見出し・条項・箇条書き・元からある段落は残します。
function formatExtractedText(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd());
  const formatted = [];
  let paragraphBreak = false;

  for (const originalLine of lines) {
    const line = originalLine.trim();
    if (!line) {
      // 連続する空行は1つの段落区切りにまとめます。
      paragraphBreak = formatted.length > 0;
      continue;
    }

    const previous = formatted.at(-1);
    const preserveBreak = startsNewSection(line) ||
      (paragraphBreak && /[。！？!?：:]$/.test(previous || "")) ||
      (previous && /[。！？!?]$/.test(previous) && /^[　 \t]/.test(originalLine));

    if (!previous || preserveBreak) {
      if (paragraphBreak && formatted.at(-1) !== "") formatted.push("");
      formatted.push(line);
    } else {
      formatted[formatted.length - 1] += needsSpace(previous, line) + line;
    }
    paragraphBreak = false;
  }

  // 段落間は空行を1つだけ残し、3個以上の連続改行を作りません。
  return formatted.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function renderResult() {
  elements.result.value = extractedPages.map((text, index) => {
    const separator = elements.separators.checked ? `--- ${index + 1}ページ目 ---\n\n` : "";
    return separator + (elements.format.checked ? formatExtractedText(text) : text);
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

elements.format.addEventListener("change", () => {
  // 元の抽出結果は保持しているので、ON/OFFを切り替えてすぐ比較できます。
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
  elements.format.checked = true;
  setStatus();
});
