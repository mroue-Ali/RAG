const OPEN = '<think>'
const CLOSE = '</think>'

/**
 * Some models write their reasoning inline, wrapped in <think> tags, ahead of
 * the answer. Separate the two. While the closing tag has not streamed in yet,
 * everything so far counts as reasoning.
 */
export function splitThinking(content: string): { reasoning: string; answer: string } {
  const text = content.trimStart()
  if (!text.startsWith(OPEN)) return { reasoning: '', answer: content }
  const close = text.indexOf(CLOSE)
  if (close === -1) return { reasoning: text.slice(OPEN.length).trim(), answer: '' }
  return {
    reasoning: text.slice(OPEN.length, close).trim(),
    answer: text.slice(close + CLOSE.length).trimStart(),
  }
}
