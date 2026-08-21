// PDF.js の座標情報を使う「数式整形」です。通常文章の段落整形とは分離し、
// 確信できる配置だけを変換します。PDFに数式の意味情報がない場合は元の文字を残します。

const SUPER = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "−": "⁻", "－": "⁻" };
const SUB = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉" };

function itemBox(item, index) {
  const transform = item.transform || [1, 0, 0, 1, 0, 0];
  const size = Math.abs(item.height) || Math.hypot(transform[2], transform[3]) || Math.hypot(transform[0], transform[1]) || 1;
  return { str: item.str || "", x: transform[4] || 0, y: transform[5] || 0,
    width: Math.abs(item.width) || Math.max(1, (item.str || "").length * size * 0.5), size,
    hasEOL: Boolean(item.hasEOL), index };
}

export function removeDuplicateTextItems(items) {
  const kept = [];
  for (const item of items.map(itemBox)) {
    // 同じ文字・ほぼ同じ位置・ほぼ同じ大きさのときだけ重ね描画と判断します。
    const duplicate = kept.some((other) => other.str === item.str &&
      Math.abs(other.x - item.x) <= Math.max(0.5, item.size * 0.04) &&
      Math.abs(other.y - item.y) <= Math.max(0.5, item.size * 0.04) &&
      Math.abs(other.size - item.size) <= Math.max(0.5, item.size * 0.05));
    if (!duplicate) kept.push(item);
  }
  return kept;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 1;
}

function scriptText(text, map) {
  const compact = text.replace(/\s/g, "");
  return compact && [...compact].every((char) => map[char]) ? [...compact].map((char) => map[char]).join("") : null;
}

function normalizeMathSpacing(text) {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\s*([×÷=+≤≥])\s*/g, "$1")
    .replace(/\s*([−－])\s*/g, " $1 ")
    .replace(/(\d)\s+([⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻₀₁₂₃₄₅₆₇₈₉]+)/g, "$1$2")
    .replace(/([A-Za-zΑ-ω])\s+([₀₁₂₃₄₅₆₇₈₉]+)/g, "$1$2")
    .replace(/\s+([′°),])/g, "$1").replace(/([(])\s+/g, "$1").replace(/[ \t]+/g, " ").trim();
}

export function detectMathItems(items) {
  const usable = items.filter((item) => item.str.trim());
  // 1行を単独で処理して添字が複数ある場合も、本文サイズを添字側へ引かれないようにします。
  const sizes = usable.map((item) => item.size).sort((a, b) => a - b);
  const normalSize = sizes[Math.floor(sizes.length * 0.75)] || 1;
  return usable.map((item) => ({ ...item, mathLike: /[=+−－×÷√∑∫≤≥πλΔαθ⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉]|\b(?:sin|cos|tan)\b/i.test(item.str),
    small: item.size < normalSize * 0.86 }));
}

function findAnchor(item, items) {
  return items.filter((candidate) => !candidate.small && candidate.x <= item.x + 0.5 &&
    item.x - (candidate.x + candidate.width) < candidate.size * 1.4 &&
    Math.abs(item.y - candidate.y) > candidate.size * 0.12 && Math.abs(item.y - candidate.y) < candidate.size * 0.9)
    .sort((a, b) => Math.abs(item.x - (a.x + a.width)) - Math.abs(item.x - (b.x + b.width)))[0];
}

function combineSafeFractions(items) {
  const consumed = new Set();
  const combined = [];
  for (const numerator of items) {
    if (consumed.has(numerator) || !/^[A-Za-z0-9.]+$/.test(numerator.str.trim())) continue;
    const denominator = items.find((candidate) => candidate !== numerator && !consumed.has(candidate) &&
      /^[A-Za-z0-9.]+$/.test(candidate.str.trim()) && numerator.y > candidate.y &&
      numerator.y - candidate.y > Math.min(numerator.size, candidate.size) * 0.65 &&
      numerator.y - candidate.y < Math.max(numerator.size, candidate.size) * 2.2 &&
      Math.abs((numerator.x + numerator.width / 2) - (candidate.x + candidate.width / 2)) < Math.max(numerator.size, candidate.size) * 0.45);
    if (!denominator) continue;
    const middleY = (numerator.y + denominator.y) / 2;
    // 左隣に演算子や括弧がある短い上下ペアだけを対象にし、段組みを分数にしません。
    const context = items.some((candidate) => candidate !== numerator && candidate !== denominator &&
      /[+−－×÷=(]/.test(candidate.str) && candidate.x + candidate.width <= Math.min(numerator.x, denominator.x) + 1 &&
      Math.min(numerator.x, denominator.x) - (candidate.x + candidate.width) < candidate.size * 2.5 &&
      Math.abs(candidate.y - middleY) < candidate.size * 0.7);
    if (!context) continue;
    combined.push({ ...numerator, str: `${numerator.str.trim()}/${denominator.str.trim()}`, y: middleY,
      width: Math.max(numerator.width, denominator.width), size: Math.max(numerator.size, denominator.size), mathLike: true, small: false });
    consumed.add(numerator); consumed.add(denominator);
  }
  return [...items.filter((item) => !consumed.has(item)), ...combined];
}

function positionedItemsToString(items) {
  const detected = combineSafeFractions(detectMathItems(items));
  const scripts = new Map();
  for (const item of detected.filter((entry) => entry.small)) {
    const anchor = findAnchor(item, detected);
    if (!anchor) continue;
    const map = item.y > anchor.y ? SUPER : SUB;
    const converted = scriptText(item.str, map);
    if (converted) scripts.set(item, { anchor, converted, isSuper: item.y > anchor.y });
  }

  // 本文の基準線を中心に行を作り、上付き・下付きは直前の基底文字へ付けます。
  const body = detected.filter((item) => !scripts.has(item)).sort((a, b) => b.y - a.y || a.x - b.x || a.index - b.index);
  const lines = [];
  for (const item of body) {
    let line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= Math.max(2, item.size * 0.35));
    if (!line) { line = { y: item.y, items: [] }; lines.push(line); }
    line.items.push(item);
  }
  lines.sort((a, b) => b.y - a.y);
  return lines.map((line) => {
    line.items.sort((a, b) => a.x - b.x || a.index - b.index);
    let output = ""; let previous = null;
    for (const item of line.items) {
      const gap = previous ? item.x - (previous.x + previous.width) : 0;
      if (previous && gap > Math.max(1, Math.min(previous.size, item.size) * 0.22)) output += " ";
      output += item.str;
      const attached = [...scripts.entries()].filter(([, value]) => value.anchor === item)
        .sort(([a], [b]) => a.x - b.x || b.y - a.y);
      output += attached.map(([, value]) => value.converted).join("");
      previous = item;
    }
    const mathScore = line.items.filter((item) => item.mathLike).length + (scripts.size ? 1 : 0);
    return mathScore ? normalizeMathSpacing(output) : output.trim();
  }).join("\n").trim();
}

export function extractMathProtectedText(rawItems) {
  return positionedItemsToString(removeDuplicateTextItems(rawItems));
}
