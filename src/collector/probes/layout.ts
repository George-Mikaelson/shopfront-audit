/**
 * Runs inside the page (serialised by page.evaluate), so it must not use
 * imports or anything outside its own body.
 */
interface Box {
  selector: string;
  width: number;
  height: number;
  text?: string;
}

export interface LayoutProbeResult {
  layoutWidth: number;
  scrollWidth: number;
  scale: number;
  overflowing: Box[];
  tapTargets: { total: number; small: Box[] };
  text: { totalChars: number; smallChars: number; samples: Box[] };
}

export function layoutProbe(args: { minTap: number; minText: number }): LayoutProbeResult {
  const doc = document.documentElement;
  const layoutWidth = doc.clientWidth;
  const scrollWidth = Math.max(doc.scrollWidth, document.body.scrollWidth);
  // How much the phone zoomed the page out to fit it (1 for responsive pages).
  const scale = Math.min(1, window.visualViewport?.scale ?? 1, window.innerWidth > 0 ? screen.width / window.innerWidth : 1);

  const describe = (el: Element): string => {
    const tag = el.tagName.toLowerCase();
    if (el.id) return `${tag}#${el.id}`;
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
    return cls.length > 0 ? `${tag}.${cls.join('.')}` : tag;
  };
  const visible = (el: Element): boolean => {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const snippet = (s: string | null | undefined): string | undefined => {
    const t = (s ?? '').replace(/\s+/g, ' ').trim();
    return t ? t.slice(0, 40) : undefined;
  };

  // Overflow: elements sticking out past the right edge whose parent does not,
  // i.e. the root causes rather than every descendant.
  const overflowing: LayoutProbeResult['overflowing'] = [];
  if (scrollWidth > layoutWidth + 1) {
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect();
      if (r.right <= layoutWidth + 1 || r.width === 0) continue;
      const parent = el.parentElement;
      const parentRight = parent && parent !== document.body ? parent.getBoundingClientRect().right : 0;
      if (parentRight > layoutWidth + 1) continue;
      overflowing.push({ selector: describe(el), width: Math.round(r.width), height: Math.round(r.height) });
    }
    overflowing.sort((a, b) => b.width - a.width);
    overflowing.splice(5);
  }

  // Tap targets. Links inside running text are exempt (WCAG 2.5.8).
  const targets = Array.from(
    document.querySelectorAll(
      'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [onclick], summary',
    ),
  ).filter(visible);
  const small: LayoutProbeResult['tapTargets']['small'] = [];
  for (const el of targets) {
    const r = el.getBoundingClientRect();
    const w = r.width * scale;
    const h = r.height * scale;
    if (Math.min(w, h) >= args.minTap) continue;
    const parent = el.parentElement;
    const inline = getComputedStyle(el).display === 'inline';
    if (inline && parent && (parent.textContent ?? '').trim().length > (el.textContent ?? '').trim().length + 25) {
      continue;
    }
    const item: Box = { selector: describe(el), width: Math.round(w), height: Math.round(h) };
    const label = snippet(el.textContent) ?? snippet(el.getAttribute('aria-label'));
    if (label) item.text = label;
    small.push(item);
  }

  // Text size after the phone's zoom.
  let totalChars = 0;
  let smallChars = 0;
  const samples: LayoutProbeResult['text']['samples'] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? '').trim();
    const parent = node.parentElement;
    if (!text || !parent || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName) || !visible(parent)) continue;
    const px = parseFloat(getComputedStyle(parent).fontSize) * scale;
    totalChars += text.length;
    if (px < args.minText) {
      smallChars += text.length;
      if (samples.length < 5) {
        // For text samples, `height` carries the effective font size in px.
        const item: Box = {
          selector: describe(parent),
          width: Math.round(parent.getBoundingClientRect().width * scale),
          height: Math.round(px * 10) / 10,
        };
        const t = snippet(text);
        if (t) item.text = t;
        samples.push(item);
      }
    }
  }

  return {
    layoutWidth,
    scrollWidth,
    scale: Math.round(scale * 1000) / 1000,
    overflowing,
    tapTargets: { total: targets.length, small },
    text: { totalChars, smallChars, samples },
  };
}
