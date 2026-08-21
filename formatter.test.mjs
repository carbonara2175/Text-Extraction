import test from "node:test";
import assert from "node:assert/strict";
import { formatExtractedText, isLikelyMathLine } from "./formatter.js";
import { extractMathProtectedText, removeDuplicateTextItems } from "./math-formatter.js";
import { analyzePageLayout, linesToText } from "./layout-analyzer.js";

test("本文途中の折り返しを結合する", () => {
  assert.equal(formatExtractedText("センターにおいて処理\nすることとし、その取扱いについては、"),
    "センターにおいて処理することとし、その取扱いについては、");
});

test("タイトル、見出し、条項、項目、箇条書き、段落を残す", () => {
  const input = "職員規程\n（趣旨）\n第１　本文の\n続きです。\n１　最初の項目\n・注意事項\n\n附則";
  assert.equal(formatExtractedText(input),
    "職員規程\n（趣旨）\n第１　本文の続きです。\n１　最初の項目\n・注意事項\n\n附則");
});

test("英単語には空白を補い、表らしい行は結合しない", () => {
  assert.equal(formatExtractedText("This is a\nPDF document."), "This is a PDF document.");
  assert.equal(formatExtractedText("氏名　　金額\n田中　　1000"), "氏名　　金額\n田中　　1000");
});

test("連続する空行を1つへまとめる", () => {
  assert.equal(formatExtractedText("段落一。\n\n\n段落二。"), "段落一。\n\n段落二。");
});

const pdfItem = (str, x, y, size = 10, width = str.length * size * 0.5) =>
  ({ str, transform: [size, 0, 0, size, x, y], width, height: size });

test("座標と文字が同じ重ね描画だけを除去する", () => {
  const items = [pdfItem("学", 0, 10), pdfItem("学", 0.1, 10.1), pdfItem("校", 6, 10), pdfItem("校", 12, 10)];
  assert.deepEqual(removeDuplicateTextItems(items).map((item) => item.str), ["学", "校", "校"]);
});

test("小さく上下に配置された指数と添字をUnicodeへ直す", () => {
  const exponent = [pdfItem("10", 0, 10, 10, 10), pdfItem("−", 10, 15, 6, 3), pdfItem("9", 13, 15, 6, 3), pdfItem("m", 19, 10)];
  assert.equal(extractMathProtectedText(exponent), "10⁻⁹ m");
  const subscript = [pdfItem("S", 0, 10), pdfItem("1", 5, 7, 6, 3)];
  assert.equal(extractMathProtectedText(subscript), "S₁");
});

test("演算子の隣にある単純な上下ペアを安全な分数へ直す", () => {
  const items = [pdfItem("t", 0, 10), pdfItem("−", 7, 10), pdfItem("x", 15, 15, 8, 4), pdfItem("5.0", 11, 5, 8, 12)];
  assert.equal(extractMathProtectedText(items), "t − x/5.0");
});

test("数式行を通常文章の改行結合から保護する", () => {
  assert.equal(isLikelyMathLine("y = 3.0×10⁻⁴"), true);
  assert.equal(formatExtractedText("説明文です。\ny = 3.0×10⁻⁴\n次の説明です。"), "説明文です。\ny = 3.0×10⁻⁴\n次の説明です。");
});

test("全幅タイトルの後で左段を読み切ってから右段へ移る", () => {
  const items = [pdfItem("物理試験", 20, 100, 10, 160), pdfItem("注意事項", 20, 88, 10, 160),
    pdfItem("問題1", 20, 70, 10, 40), pdfItem("問題3", 120, 70, 10, 40),
    pdfItem("問題2", 20, 55, 10, 40), pdfItem("問題4", 120, 55, 10, 40)];
  const result = analyzePageLayout(items, 200);
  assert.equal(result.isTwoColumn, true);
  assert.equal(linesToText(result.lines, extractMathProtectedText), "物理試験\n注意事項\n問題1\n問題2\n問題3\n問題4");
});

test("中央の空白が不明瞭な通常文書は上から下、左から右を維持する", () => {
  const items = [pdfItem("通常の長い本文", 20, 80, 10, 150), pdfItem("続きの本文", 20, 65, 10, 150),
    pdfItem("さらに続く本文", 20, 50, 10, 150), pdfItem("末尾", 20, 35, 10, 150)];
  const result = analyzePageLayout(items, 200);
  assert.equal(result.isTwoColumn, false);
  assert.equal(linesToText(result.lines, extractMathProtectedText), "通常の長い本文\n続きの本文\nさらに続く本文\n末尾");
});

test("レイアウト解析後も上付き・下付き文字を維持する", () => {
  const items = [pdfItem("10", 20, 70, 10, 10), pdfItem("−", 30, 75, 6, 3), pdfItem("9", 33, 75, 6, 3),
    pdfItem("S", 20, 55), pdfItem("1", 25, 52, 6, 3)];
  const result = analyzePageLayout(items, 200);
  assert.equal(linesToText(result.lines, extractMathProtectedText), "10⁻⁹\nS₁");
});
