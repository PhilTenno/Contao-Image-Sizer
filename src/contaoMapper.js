/**
 * Contao 5 Image Size Configuration Generator
 *
 * HOW CONTAO USES THESE FIELDS (from PictureGenerator source):
 *
 *  - width (Breite): The 1x reference size AND the src fallback image.
 *    Contao internally converts w-descriptors to multipliers by dividing
 *    by this value (e.g. "800w" ÷ width = density factor).
 *    The src attribute gets the image at this pixel width.
 *    → Should be the measured width at the STANDARD DESKTOP viewport (~1200px),
 *      NOT the widescreen maximum. Widescreen + Retina are covered by srcset.
 *
 *  - densities: w-descriptors for srcset, e.g. "400w, 800w, 1200w, 1600w"
 *    Covers mobile (1x+2x) through desktop (1x+2x). Capped at 3200w.
 *
 *  - sizes: HTML sizes attribute, e.g. "(max-width: 768px) 95vw, 50vw"
 *    Tells the browser the display size per viewport so it picks correctly.
 */

// Maximum w-descriptor to generate (prevents absurdly large image variants)
const MAX_DENSITY_WIDTH = 3200;

const NICE_WIDTHS = [200, 300, 400, 500, 600, 700, 800, 900, 1000, 1200, 1400, 1600, 1800, 2000, 2400, 2800, 3200];

/**
 * Round a pixel value up to the nearest "nice" width from our predefined list.
 * Falls back to rounding to nearest 100.
 */
function toNiceWidth(px) {
  for (const w of NICE_WIDTHS) {
    if (w >= px) return w;
  }
  return Math.ceil(px / 100) * 100;
}

/**
 * Calculate vw percentage: how much of the viewport width does the image occupy?
 */
function toVw(imageWidth, viewportWidth) {
  return Math.round((imageWidth / viewportWidth) * 100);
}

/**
 * Generate w-descriptor list covering all measured widths at 1x and 2x.
 * Also adds a 3x reference for mobile viewports (≤768px) based on the
 * largest modern phone width (430px, iPhone 15 Pro Max) to ensure
 * 3x-DPR devices (412px×3=1236px) don't overshoot to the next step.
 * Then gap-fills any consecutive pair with >30% jump (critical range ≤2000px).
 */
function generateDensities(measurements, viewports) {
  const widthSet = new Set();

  for (const vp of viewports) {
    const m = measurements[vp];
    if (!m) continue;
    const w = m.width;
    if (w < 50) continue;

    // 1x and 2x (standard)
    widthSet.add(toNiceWidth(w));
    widthSet.add(toNiceWidth(w * 2));

    if (vp <= 768) {
      // PSI/Lighthouse mobile simulation uses DPR ≈ 1.75 for its
      // "Properly Size Images" audit. Adding a 1.75x variant ensures
      // PSI picks a variant very close to its ideal (CSS_width × 1.75)
      // instead of jumping to the 2x variant (~22% oversized).
      // e.g. 375px × 1.75 = 656px → toNiceWidth = 700w ← PSI sweet spot
      widthSet.add(toNiceWidth(w * 1.75));

      // 3x DPR for large flagship phones (up to ~430px wide)
      // e.g. 430px × 3 DPR = 1290px → 1400w
      // Prevents iPhone 14 Pro Max / large Android phones from jumping to 1600w
      const ref3x = Math.max(w, 430) * 3;
      widthSet.add(toNiceWidth(ref3x));
    }
  }

  const sorted = Array.from(widthSet)
    .filter((w) => w <= MAX_DENSITY_WIDTH)
    .sort((a, b) => a - b);

  // Remove duplicates that are within 10% of each other
  // (10% instead of 15% to keep both 1400w and 1600w when both are needed)
  const deduped = [];
  for (const w of sorted) {
    const last = deduped[deduped.length - 1];
    if (!last || w / last > 1.10) {
      deduped.push(w);
    }
  }

  // Gap-fill: for consecutive pairs with >30% jump in the critical mobile/tablet
  // range (≤2000px), insert the NICE_WIDTH closest to the geometric mean.
  // This ensures no device falls into a gap where it loads a much larger variant.
  const filtered = [];
  for (let i = 0; i < deduped.length; i++) {
    filtered.push(deduped[i]);
    if (i < deduped.length - 1) {
      const a = deduped[i];
      const b = deduped[i + 1];
      if (a >= 200 && b <= 2000 && b / a > 1.3) {
        const mid = Math.round(Math.sqrt(a * b)); // geometric mean
        const fill = NICE_WIDTHS.reduce(
          (best, nw) =>
            nw > a && nw < b && Math.abs(nw - mid) < Math.abs(best - mid) ? nw : best,
          Infinity
        );
        if (Number.isFinite(fill)) filtered.push(fill);
      }
    }
  }

  return filtered.map((w) => `${w}w`).join(', ');
}

/**
 * Generate a responsive sizes attribute from viewport measurements.
 * Format: "(max-width: Xpx) Yvw, Zvw"
 *
 * Strategy:
 * - Sort viewports ascending
 * - For each viewport (except the largest), emit a max-width media query
 *   with the vw value measured at that viewport
 * - The last entry is the fallback (no media query)
 * - Merge consecutive entries with equal or near-equal vw values
 */
function generateSizes(measurements, viewports) {
  const sorted = [...viewports].sort((a, b) => a - b);
  const entries = [];

  for (const vp of sorted) {
    const m = measurements[vp];
    if (!m || m.width < 50) continue;

    entries.push({ vp, width: m.width, vw: toVw(m.width, vp) });
  }

  if (entries.length === 0) return '100vw';
  if (entries.length === 1) return `${entries[0].vw}vw`;

  // If all measured widths are within 8px → truly fixed-size, just output px
  const minW = Math.min(...entries.map((e) => e.width));
  const maxW = Math.max(...entries.map((e) => e.width));
  if (maxW - minW < 8) {
    return `${Math.round((minW + maxW) / 2)}px`;
  }

  // Detect if image has a fixed pixel width across adjacent entries
  const isFixed = (a, b) => Math.abs(a.width - b.width) < 8;

  const parts = [];

  for (let i = 0; i < entries.length - 1; i++) {
    const curr = entries[i];
    const next = entries[i + 1];

    // If the vw % barely changes, skip this breakpoint
    if (Math.abs(curr.vw - next.vw) <= 4) continue;

    // If image has fixed size on this viewport and the next ones too,
    // emit px value instead of vw for better accuracy
    if (isFixed(curr, next)) {
      // Check if ALL remaining entries share this same px width
      const restAllFixed = entries.slice(i).every((e) => isFixed(e, curr));
      if (restAllFixed) {
        // All remaining viewports have same px size → let the px fallback cover them
        break;
      }
      parts.push(`(max-width: ${curr.vp}px) ${curr.width}px`);
    } else {
      parts.push(`(max-width: ${curr.vp}px) ${curr.vw}vw`);
    }
  }

  // Final fallback (largest viewport)
  const last = entries[entries.length - 1];
  const secondLast = entries[entries.length - 2];
  if (secondLast && isFixed(secondLast, last)) {
    parts.push(`${last.width}px`);
  } else {
    parts.push(`${last.vw}vw`);
  }

  return parts.join(', ');
}

/**
 * Determine best resize mode for an image.
 * - If natural dimensions are known and aspect ratio varies, use "proportional"
 * - Default: "proportional"
 */
function determineResizeMode(meta) {
  return 'proportional';
}

/**
 * Generate a suggested Contao image size name from context/filename/alt.
 */
function generateName(meta) {
  // Try alt text first (most descriptive)
  if (meta.alt && meta.alt.length > 2 && meta.alt.length < 50) {
    return slugify(meta.alt);
  }

  // Try filename from src
  if (meta.src) {
    try {
      const path = new URL(meta.src).pathname;
      const file = path.split('/').pop().replace(/\.[^.]+$/, '').replace(/[-_]+/g, '_');
      const clean = slugify(file);
      if (clean && clean.length > 2 && !clean.match(/^(img|image|photo|pic|thumb|thumbnail|\d+)$/)) {
        return clean.slice(0, 40);
      }
    } catch {}
  }

  // Fall back to context label
  const label = meta.contextLabel || meta.selector || 'bild';
  return slugify(label) || 'image_size';
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

/**
 * Generate child items (tl_image_size_item) for breakpoint-specific overrides.
 * Only creates items where the image size changes significantly.
 */
function generateChildItems(measurements, viewports) {
  const sorted = [...viewports].sort((a, b) => a - b);
  const items = [];

  // Work from smallest to largest breakpoint
  for (let i = 0; i < sorted.length - 1; i++) {
    const vp = sorted[i];
    const m = measurements[vp];
    if (!m || m.width < 50) continue;

    const nextVp = sorted[i + 1];
    const nextM = measurements[nextVp];

    // Only add item if image size changes significantly (>15%)
    if (nextM && Math.abs(m.width - nextM.width) / Math.max(m.width, nextM.width) < 0.15) {
      continue;
    }

    const w = toNiceWidth(m.width);
    const densities = `${w}w, ${toNiceWidth(m.width * 2)}w`;

    items.push({
      media: `(max-width: ${vp}px)`,
      width: w,
      height: '',
      resizeMode: 'proportional',
      densities,
    });
  }

  return items;
}

/**
 * Main mapping function: converts analyzer results to Contao config.
 */
export function generateContaoConfig(analysisResults, viewports) {
  return analysisResults.map((result) => {
    const { meta, measurements } = result;

    // Find max rendered width across all viewports
    const maxWidth = Object.values(measurements).reduce(
      (max, m) => (m.width > max ? m.width : max),
      0
    );

    if (maxWidth < 50) return null;

    const densities = generateDensities(measurements, viewports);
    const sizes = generateSizes(measurements, viewports);
    const name = generateName(meta);
    const childItems = generateChildItems(measurements, viewports);

    // Recommended Breite (width):
    // Per Contao source (PictureGenerator): Breite is the 1x reference AND
    // the src fallback. It should be the display width at the STANDARD DESKTOP
    // viewport (not widescreen). Larger variants (widescreen + retina) are
    // covered by the w-descriptors in densities.
    //
    // Strategy: use the measurement at the largest viewport ≤ 1400px.
    // This typically corresponds to a 1200px desktop — the most common layout
    // breakpoint. Widescreen (1920px+) measurements stay in the srcset only.
    const sortedVps = [...viewports].sort((a, b) => a - b);
    const desktopVp =
      sortedVps.filter((vp) => vp <= 1400).pop() ||   // last vp ≤ 1400px
      sortedVps[Math.max(0, sortedVps.length - 2)] ||  // 2nd largest if none
      sortedVps[sortedVps.length - 1];                 // absolute fallback

    const desktopMeasurement = measurements[desktopVp];
    const desktopWidth = desktopMeasurement ? desktopMeasurement.width : maxWidth;
    const recommendedWidth = toNiceWidth(desktopWidth);

    // Build per-viewport table data
    const viewportData = viewports.map((vp) => {
      const m = measurements[vp];
      if (!m) return { viewport: vp, width: null, vw: null };
      return {
        viewport: vp,
        width: m.width,
        vw: toVw(m.width, vp),
      };
    });

    return {
      meta,
      viewportData,
      contaoConfig: {
        name,
        width: String(recommendedWidth),
        height: '',
        resizeMode: determineResizeMode(meta),
        zoom: '',
        densities,
        sizes,
        lazyLoading: meta.isLazy,
      },
      childItems,
    };
  }).filter(Boolean);
}
