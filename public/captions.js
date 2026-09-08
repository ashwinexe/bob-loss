export function cleanCaption(text = '') {
  return text.replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
    .replace(/<break\b[^>]*\/?\s*>/gi, '...').replace(/<[^>]*>/g, '')
    .replace(/\s+([,.!?])/g, '$1').replace(/\.{4,}/g, '...').replace(/\s+/g, ' ').trim();
}
export function captionAt(words, seconds) {
  // Clean complete groups rather than individual tokens: a tag may span tokens.
  const i = words.findIndex(w => seconds >= w.start_s && seconds <= w.stop_s + .25);
  if(i < 0) return '';
  const start = Math.floor(i / 10) * 10;
  return cleanCaption(words.slice(start, start + 10).map(w => w.text.trim()).join(' '));
}
