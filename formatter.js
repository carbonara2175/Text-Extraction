// PDFの見た目上の折り返しと、文書構造として必要な改行を区別します。
// 判断に迷う表や箇条書きは、誤って結合しないことを優先します。

function startsNewSection(line) {
  return /^(?:[（(][^）)\n]{1,30}[）)]|附\s*則(?:\s|$)|第[0-9０-９一二三四五六七八九十百千]+(?:条|項|節|章|編)?(?:[\s　、.)）]|$)|[0-9０-９一二三四五六七八九十]+(?:[.．、)）]|[\s　]+)|[・●○■□◆◇▶▷※]|[-*+]\s+)/.test(line);
}

function isLayoutSensitive(line) {
  // タブ、縦線、離れた複数列は表である可能性が高いため、そのままの行を残します。
  return /\t|[|｜]|\S[ 　]{2,}\S/.test(line);
}

export function isLikelyMathLine(line) {
  const signals = (line.match(/[=+−－×÷√∑∫≤≥πλΔαθ⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉′°]/g) || []).length;
  const formulaWords = (line.match(/\b(?:sin|cos|tan)\b/gi) || []).length;
  const numberOperators = /\d\s*[+−－×÷/=]\s*\d/.test(line) ? 2 : 0;
  // キーワード1個だけでは文章を数式扱いせず、複数の根拠がある場合に保護します。
  return signals + formulaWords + numberOperators >= 2;
}

function isLikelyTitle(line, index) {
  // 先頭かつ、タイトルでよく使う語尾を持つ短い行だけに限定して誤結合を避けます。
  return index === 0 && line.length <= 50 &&
    /(?:規程|規則|要綱|要領|方針|計画|報告書|通知|お知らせ|について)$/.test(line);
}

function needsSpace(left, right) {
  // 英数字の単語だけは、行をつなぐ際に単語間の空白を補います。日本語には空白を入れません。
  return /[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right) ? " " : "";
}

export function formatExtractedText(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd());
  const formatted = [];
  let paragraphBreak = false;
  let contentIndex = 0;
  let previousWasTitle = false;
  let previousWasLayoutSensitive = false;
  let previousWasMath = false;

  for (const originalLine of lines) {
    const line = originalLine.trim();
    if (!line) {
      // 空行が何個続いても、段落区切りは1つだけにします。
      paragraphBreak = formatted.length > 0;
      continue;
    }

    const previous = formatted.at(-1);
    const indented = /^[ \t　]/.test(originalLine);
    const currentIsLayoutSensitive = isLayoutSensitive(originalLine);
    const currentIsTitle = isLikelyTitle(line, contentIndex);
    const currentIsMath = isLikelyMathLine(line);
    const preserveBreak = startsNewSection(line) || paragraphBreak || indented ||
      previousWasTitle || currentIsLayoutSensitive || previousWasLayoutSensitive || currentIsMath || previousWasMath;

    if (!previous || preserveBreak) {
      if (paragraphBreak && formatted.at(-1) !== "") formatted.push("");
      formatted.push(line);
    } else {
      // 上記の構造に当てはまらない改行は、PDFの用紙幅による折り返しとして結合します。
      formatted[formatted.length - 1] += needsSpace(previous, line) + line;
    }

    paragraphBreak = false;
    previousWasTitle = currentIsTitle;
    previousWasLayoutSensitive = currentIsLayoutSensitive;
    previousWasMath = currentIsMath;
    contentIndex += 1;
  }

  return formatted.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
