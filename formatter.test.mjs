import test from "node:test";
import assert from "node:assert/strict";
import { formatExtractedText } from "./formatter.js";

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
