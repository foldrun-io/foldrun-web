// What the extractor (i18n-extract.mjs) and the census (i18n-scan.mjs) both
// need to agree on: which strings are not words at all.

/** "rounded border px-2 text-fg-muted" — Tailwind classes, not words: most
 *  of the words are utilities or carry a variant prefix. */
export const UTILITY = /^!?-?((sm|md|lg|xl|2xl|hover|focus|focus-visible|active|dark|group|group-hover|peer|data|aria|first|last|odd|even|disabled|placeholder|print|motion-safe|motion-reduce)[-:[\w\]=&'"/.]*:)*(p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|w|h|min|max|size|text|bg|border|rounded|flex|grid|gap|space|items|justify|font|leading|tracking|shadow|ring|outline|opacity|z|top|left|right|bottom|start|end|inset|overflow|truncate|whitespace|break|cursor|select|pointer|transition|duration|ease|animate|col|row|order|shrink|grow|basis|self|place|content|list|underline|line|decoration|sr|not|fill|stroke|object|aspect|block|inline|hidden|contents|table|absolute|relative|fixed|sticky|static|visible|invisible|italic|uppercase|lowercase|capitalize|normal-case|antialiased|tabular|divide|scale|rotate|translate|origin|backdrop|blur|from|to|via|container|mx-auto|resize|appearance|caret|accent|scroll|snap|touch|will|columns|float|clear|isolate|mix|filter|drop|sepia|invert|grayscale|brightness|contrast|saturate|hue|tab|indent|align|whitespace|hyphens|box|shrink-0|grow-0)(-[\w./\[\]()%#:,'"-]*)?$/;
export function looksLikeClasses(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  return words.filter((w) => UTILITY.test(w)).length / words.length >= 0.6;
}

/** A multi-line code sample or file tree: a translator must not touch it. */
export function looksLikeCode(text) {
  return /\n/.test(text.trim()) && /[/#=]|--|\$ /.test(text);
}
