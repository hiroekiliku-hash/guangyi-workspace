export function tokenizeCPP(source) {
const MAX_SOURCE = 20000;

const KEYWORDS = new Set([
  "alignas",
  "alignof",
  "and",
  "and_eq",
  "asm",
  "auto",
  "bitand",
  "bitor",
  "bool",
  "break",
  "case",
  "catch",
  "char",
  "char8_t",
  "char16_t",
  "char32_t",
  "class",
  "compl",
  "concept",
  "const",
  "consteval",
  "constexpr",
  "constinit",
  "const_cast",
  "continue",
  "co_await",
  "co_return",
  "co_yield",
  "decltype",
  "default",
  "delete",
  "do",
  "double",
  "dynamic_cast",
  "else",
  "enum",
  "explicit",
  "export",
  "extern",
  "false",
  "float",
  "for",
  "friend",
  "goto",
  "if",
  "inline",
  "int",
  "long",
  "mutable",
  "namespace",
  "new",
  "noexcept",
  "not",
  "not_eq",
  "nullptr",
  "operator",
  "or",
  "or_eq",
  "private",
  "protected",
  "public",
  "register",
  "reinterpret_cast",
  "requires",
  "return",
  "short",
  "signed",
  "sizeof",
  "static",
  "static_assert",
  "static_cast",
  "struct",
  "switch",
  "template",
  "this",
  "thread_local",
  "throw",
  "true",
  "try",
  "typedef",
  "typeid",
  "typename",
  "union",
  "unsigned",
  "using",
  "virtual",
  "void",
  "volatile",
  "wchar_t",
  "while",
  "xor",
  "xor_eq",
  "override",
  "final",
]);

function isAsciiLetter(ch) {
  return (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z");
}

function isIdentStart(ch) {
  return isAsciiLetter(ch) || ch === "_";
}

function isIdentPart(ch) {
  return isIdentStart(ch) || (ch >= "0" && ch <= "9");
}

function isDigit(ch) {
  return ch >= "0" && ch <= "9";
}

function isHex(ch) {
  return isDigit(ch) || (ch >= "a" && ch <= "f") || (ch >= "A" && ch <= "F");
}

function isBin(ch) {
  return ch === "0" || ch === "1";
}

function isWsNoNl(ch) {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\f" || ch === "\v";
}

function isRawDelimChar(ch) {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  if (code <= 32) return false;
  if (ch === "(" || ch === ")" || ch === "\\" || ch === '"') return false;
  return true;
}

function rawPrefixLength(source, i) {
  const n = source.length;
  let k = i;
  if (k + 1 < n && source[k] === "u" && source[k + 1] === "8") k += 2;
  else if (k < n && (source[k] === "u" || source[k] === "U" || source[k] === "L")) k += 1;
  if (k < n && source[k] === "R" && k + 1 < n && source[k + 1] === '"') return k + 2 - i;
  return 0;
}

function scanNumber(source, i) {
  const n = source.length;
  let j = i;
  const c0 = source[j];
  if (c0 === ".") {
    if (j + 1 >= n || !isDigit(source[j + 1])) return i;
    j += 1;
    while (j < n && (isDigit(source[j]) || source[j] === "'")) j += 1;
    if (j < n && (source[j] === "e" || source[j] === "E")) {
      j += 1;
      if (j < n && (source[j] === "+" || source[j] === "-")) j += 1;
      while (j < n && (isDigit(source[j]) || source[j] === "'")) j += 1;
    }
    while (j < n && isAsciiLetter(source[j])) j += 1;
    return j;
  }
  if (!isDigit(c0)) return i;
  if (c0 === "0" && j + 1 < n && (source[j + 1] === "x" || source[j + 1] === "X")) {
    j += 2;
    while (j < n && (isHex(source[j]) || source[j] === "'")) j += 1;
    if (j < n && source[j] === ".") {
      j += 1;
      while (j < n && (isHex(source[j]) || source[j] === "'")) j += 1;
    }
    if (j < n && (source[j] === "p" || source[j] === "P")) {
      j += 1;
      if (j < n && (source[j] === "+" || source[j] === "-")) j += 1;
      while (j < n && (isDigit(source[j]) || source[j] === "'")) j += 1;
    }
    while (j < n && isAsciiLetter(source[j])) j += 1;
    return j;
  }
  if (c0 === "0" && j + 1 < n && (source[j + 1] === "b" || source[j + 1] === "B")) {
    j += 2;
    while (j < n && (isBin(source[j]) || source[j] === "'")) j += 1;
    while (j < n && isAsciiLetter(source[j])) j += 1;
    return j;
  }
  while (j < n && (isDigit(source[j]) || source[j] === "'")) j += 1;
  if (j < n && source[j] === ".") {
    if (j + 1 < n && source[j + 1] === ".") return j;
    j += 1;
    while (j < n && (isDigit(source[j]) || source[j] === "'")) j += 1;
  }
  if (j < n && (source[j] === "e" || source[j] === "E")) {
    j += 1;
    if (j < n && (source[j] === "+" || source[j] === "-")) j += 1;
    while (j < n && (isDigit(source[j]) || source[j] === "'")) j += 1;
  }
  while (j < n && isAsciiLetter(source[j])) j += 1;
  return j;
}

function scanQuoted(source, i, quote) {
  const n = source.length;
  let j = i + 1;
  while (j < n) {
    const ch = source[j];
    if (ch === "\\") {
      j += 1;
      if (j < n) j += 1;
      continue;
    }
    if (ch === quote) {
      j += 1;
      break;
    }
    j += 1;
  }
  return j;
}

function scanRawString(source, i, prefixLen) {
  const n = source.length;
  let j = i + prefixLen;
  let delim = "";
  while (j < n && isRawDelimChar(source[j]) && delim.length < 16) {
    delim += source[j];
    j += 1;
  }
  if (j >= n || source[j] !== "(") {
    return n;
  }
  j += 1;
  const closer = ")" + delim + '"';
  while (j < n) {
    if (source.startsWith(closer, j)) return j + closer.length;
    j += 1;
  }
  return n;
}

function scanLineComment(source, i) {
  const n = source.length;
  let j = i + 2;
  while (j < n && source[j] !== "\n") j += 1;
  return j;
}

function scanBlockComment(source, i) {
  const n = source.length;
  let j = i + 2;
  while (j < n) {
    if (source[j] === "*" && j + 1 < n && source[j + 1] === "/") {
      return j + 2;
    }
    j += 1;
  }
  return n;
}


  if (typeof source !== "string") {
    throw new TypeError("tokenizeCPP expects a string");
  }
  if (source.length > MAX_SOURCE) {
    throw new TypeError("tokenizeCPP source exceeds 20000 UTF16 units");
  }

  const tokens = [];
  const emit = (text, kind) => {
    if (!text) return;
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind) last.text += text;
    else tokens.push({ text, kind });
  };

  const n = source.length;
  let i = 0;
  let atLineStart = true;

  while (i < n) {
    const ch = source[i];

    if (ch === "\n") {
      emit(ch, "plain");
      i += 1;
      atLineStart = true;
      continue;
    }

    if (atLineStart && isWsNoNl(ch)) {
      let j = i;
      while (j < n && isWsNoNl(source[j])) j += 1;
      emit(source.slice(i, j), "plain");
      i = j;
      continue;
    }

    if (atLineStart && ch === "#") {
      let j = i + 1;
      while (j < n && isWsNoNl(source[j])) j += 1;
      while (j < n && isIdentPart(source[j])) j += 1;
      emit(source.slice(i, j), "preprocessor");
      i = j;
      atLineStart = false;
      continue;
    }

    atLineStart = false;

    if (ch === "/" && i + 1 < n && source[i + 1] === "/") {
      const j = scanLineComment(source, i);
      emit(source.slice(i, j), "comment");
      i = j;
      continue;
    }

    if (ch === "/" && i + 1 < n && source[i + 1] === "*") {
      const j = scanBlockComment(source, i);
      emit(source.slice(i, j), "comment");
      i = j;
      continue;
    }

    const rp = rawPrefixLength(source, i);
    if (rp) {
      const j = scanRawString(source, i, rp);
      emit(source.slice(i, j), "string");
      i = j;
      continue;
    }

    let quoteStart = i;
    if (ch === "u" && i + 2 < n && source[i + 1] === "8" && (source[i + 2] === '"' || source[i + 2] === "'")) {
      quoteStart = i;
      i += 2;
    } else if ((ch === "L" || ch === "u" || ch === "U") && i + 1 < n && (source[i + 1] === '"' || source[i + 1] === "'")) {
      quoteStart = i;
      i += 1;
    }
    const quoteCh = source[i];
    if (quoteCh === '"' || quoteCh === "'") {
      const j = scanQuoted(source, i, quoteCh);
      emit(source.slice(quoteStart, j), "string");
      i = j;
      continue;
    }
    i = quoteStart;

    const numEnd = scanNumber(source, i);
    if (numEnd > i) {
      emit(source.slice(i, numEnd), "number");
      i = numEnd;
      continue;
    }

    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < n && isIdentPart(source[j])) j += 1;
      const word = source.slice(i, j);
      emit(word, KEYWORDS.has(word) ? "keyword" : "plain");
      i = j;
      continue;
    }

    emit(ch, "plain");
    i += 1;
  }

  return tokens;
}
