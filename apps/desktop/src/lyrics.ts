export function parseLrc(text: string): { time: number; text: string }[] {
  const offset = Number(text.match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0) / 1000;
  return text.split(/\r?\n/).flatMap(line => {
    const timestamps = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const content = line.replace(/\[[^\]]*\]/g, '').trim();
    return timestamps.map(match => ({ time: Number(match[1]) * 60 + Number(match[2]) + offset, text: content }));
  }).sort((a, b) => a.time - b.time);
}
