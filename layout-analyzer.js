// PDF.js の座標から「文字の意味」ではなく「人が読む順番」だけを推定します。
// 判定が曖昧なページは、従来どおり上→下・左→右へ戻す保守的な設計です。

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 1;
}

function box(item, index) {
  const transform = item.transform || [1, 0, 0, 1, 0, 0];
  const height = Math.abs(item.height) || Math.hypot(transform[2], transform[3]) || 1;
  return { item, index, x: transform[4] || 0, y: transform[5] || 0,
    width: Math.abs(item.width) || Math.max(1, (item.str || "").length * height * 0.5), height };
}

// 上付き・下付き文字も本文と同じ行へ入るよう、文字高に応じた小さな誤差を許します。
export function groupTextLines(items) {
  const boxes = items.map(box).filter((entry) => entry.item.str?.trim());
  // 小さな添字が多数あっても本文高を過小評価しないよう、上位四分位を基準にします。
  const heights = boxes.map((entry) => entry.height).sort((a, b) => a - b);
  const normalHeight = heights[Math.floor(heights.length * 0.75)] || 1;
  const lines = [];
  for (const entry of boxes.sort((a, b) => b.y - a.y || a.x - b.x || a.index - b.index)) {
    let line = lines.find((candidate) => Math.abs(candidate.y - entry.y) <= Math.max(2, normalHeight * 0.6));
    if (!line) { line = { y: entry.y, boxes: [] }; lines.push(line); }
    line.boxes.push(entry);
    line.y = Math.max(line.y, entry.y);
  }
  return lines.flatMap((line) => {
    line.boxes.sort((a, b) => a.x - b.x || a.index - b.index);
    // 同じ高さでも段間ほど離れた文字群は別の行断片にします。最終的な段判定は
    // この後さらに複数行・中央空白を要求するため、表を即座に2段扱いはしません。
    const parts = [[]];
    for (const entry of line.boxes) {
      const previous = parts.at(-1).at(-1);
      if (previous && entry.x - (previous.x + previous.width) > normalHeight * 4) parts.push([]);
      parts.at(-1).push(entry);
    }
    return parts.map((part) => ({ y: line.y, boxes: part,
      left: Math.min(...part.map((entry) => entry.x)),
      right: Math.max(...part.map((entry) => entry.x + entry.width)),
      height: median(part.map((entry) => entry.height)), items: part.map((entry) => entry.item) }));
  }).sort((a, b) => b.y - a.y || a.left - b.left);
}

export function detectColumns(lines, pageWidth) {
  if (lines.length < 4 || !pageWidth) return null;
  // ページ中央付近で、どの文字列も横切らない最も広い帯を「段間」の候補にします。
  const edges = [...new Set(lines.flatMap((line) => [line.left, line.right]))].sort((a, b) => a - b);
  const gaps = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const start = edges[i]; const end = edges[i + 1]; const center = (start + end) / 2;
    if (center < pageWidth * 0.32 || center > pageWidth * 0.68 || end - start < pageWidth * 0.055) continue;
    // この帯を横切る行は後で全幅行に分類するため、タイトルがあっても候補から外しません。
    gaps.push({ start, end, center, width: end - start });
  }
  const gap = gaps.sort((a, b) => b.width - a.width)[0];
  if (!gap) return null;
  const left = lines.filter((line) => line.right <= gap.start + 1);
  const right = lines.filter((line) => line.left >= gap.end - 1);
  if (left.length < 2 || right.length < 2) return null;
  const overlap = Math.min(Math.max(...left.map((line) => line.y)), Math.max(...right.map((line) => line.y))) -
    Math.max(Math.min(...left.map((line) => line.y)), Math.min(...right.map((line) => line.y)));
  if (overlap < median(lines.map((line) => line.height)) * 1.2) return null;
  return { ...gap, left, right };
}

function topDown(lines) { return [...lines].sort((a, b) => b.y - a.y || a.left - b.left); }

// 全幅行を境界として区切ることで「全幅の注意事項→左右の問題→全幅の脚注」を保ちます。
export function sortTextByReadingOrder(lines, columns) {
  if (!columns) return topDown(lines);
  const side = (line) => line.right <= columns.start + 1 ? "left" :
    line.left >= columns.end - 1 ? "right" : "full";
  const output = []; let band = [];
  const flush = () => {
    const left = topDown(band.filter((line) => side(line) === "left"));
    const right = topDown(band.filter((line) => side(line) === "right"));
    // 両段に複数行がある範囲だけを段組みにし、片側だけなら通常順を守ります。
    output.push(...(left.length >= 2 && right.length >= 2 ? [...left, ...right] : topDown(band)));
    band = [];
  };
  for (const line of topDown(lines)) {
    if (side(line) === "full") { flush(); output.push(line); } else band.push(line);
  }
  flush(); return output;
}

export function analyzePageLayout(items, pageWidth) {
  const lines = groupTextLines(items);
  const columns = detectColumns(lines, pageWidth);
  return { lines: sortTextByReadingOrder(lines, columns), isTwoColumn: Boolean(columns), columns };
}

export function linesToText(lines, lineFormatter) {
  const normalHeight = median(lines.map((line) => line.height));
  return lines.map((line, index) => {
    const text = lineFormatter(line.items);
    const next = lines[index + 1];
    // 大きな縦方向の空白（図・画像の可能性）では空行を残し、文章整形による結合を防ぎます。
    return next && line.y - next.y > normalHeight * 2.8 ? `${text}\n` : text;
  }).join("\n").trim();
}
