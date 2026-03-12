import { chromium } from 'playwright';

/**
 * Groups images by their container context (gallery, slider, list, etc.)
 * Returns the first image of each group as the representative.
 */
function groupImages(images) {
  const groups = new Map();
  const standalone = [];

  for (const img of images) {
    if (img.groupKey) {
      if (!groups.has(img.groupKey)) {
        groups.set(img.groupKey, { ...img, isGroup: true, groupCount: 0 });
      }
      groups.get(img.groupKey).groupCount++;
    } else {
      standalone.push(img);
    }
  }

  return [...standalone, ...groups.values()];
}

/**
 * Main analyzer: visits a URL at multiple viewports using Playwright,
 * measures clientWidth of all <img> and <picture> elements.
 */
export async function analyzeUrl(url, viewports = [375, 768, 1200, 1920]) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const allMeasurements = new Map(); // key -> { meta, measurements: { [vp]: width } }

    for (const vpWidth of viewports) {
      const context = await browser.newContext({
        viewport: { width: vpWidth, height: Math.round(vpWidth * 0.75) },
        deviceScaleFactor: 1,
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });

      const page = await context.newPage();

      // Allow local domains and self-signed certs
      await page.route('**/*', (route) => route.continue());

      try {
        await page.goto(url, {
          waitUntil: 'networkidle',
          timeout: 30000,
        });
      } catch {
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
      }

      // Scroll through the page to trigger lazy-loaded images
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          let totalHeight = 0;
          const distance = 400;
          const timer = setInterval(() => {
            window.scrollBy(0, distance);
            totalHeight += distance;
            if (totalHeight >= document.body.scrollHeight) {
              clearInterval(timer);
              window.scrollTo(0, 0);
              resolve();
            }
          }, 80);
          // Safety timeout
          setTimeout(() => { clearInterval(timer); resolve(); }, 8000);
        });
      });

      // Wait for lazy images to load their dimensions
      await page.waitForTimeout(1200);

      // Collect image data from DOM
      const images = await page.evaluate(() => {
        const results = [];

        // Helper: get unique CSS selector for an element
        function getSelector(el) {
          const parts = [];
          let current = el;
          while (current && current !== document.body) {
            let part = current.tagName.toLowerCase();
            if (current.id) {
              part += `#${current.id}`;
              parts.unshift(part);
              break;
            }
            const classes = Array.from(current.classList)
              .filter((c) => !c.match(/^(active|hover|focus|open|is-|has-)/))
              .slice(0, 2);
            if (classes.length) part += `.${classes.join('.')}`;
            const siblings = current.parentElement
              ? Array.from(current.parentElement.children).filter(
                  (s) => s.tagName === current.tagName
                )
              : [];
            if (siblings.length > 1) {
              const idx = siblings.indexOf(current) + 1;
              part += `:nth-of-type(${idx})`;
            }
            parts.unshift(part);
            current = current.parentElement;
            if (parts.length >= 4) break;
          }
          return parts.join(' > ');
        }

        // Helper: detect group container
        function getGroupKey(el) {
          const groupSelectors = [
            '.ce_gallery',
            '.ce_slider',
            '.swiper',
            '.swiper-wrapper',
            '.slick-list',
            '.owl-carousel',
            'ul.image-list',
            'ol.image-list',
            '.image-grid',
            '.gallery',
            '.slider',
            '[data-slider]',
          ];

          let parent = el.parentElement;
          for (let i = 0; i < 8; i++) {
            if (!parent || parent === document.body) break;
            for (const sel of groupSelectors) {
              try {
                if (parent.matches(sel)) {
                  // Use tagName + classes as key
                  const key = `${sel}::${getContainerPath(parent)}`;
                  return key;
                }
              } catch {}
            }
            // Also detect ul/ol containing images
            if (
              (parent.tagName === 'UL' || parent.tagName === 'OL') &&
              parent.querySelectorAll('img').length > 1
            ) {
              return `list::${getContainerPath(parent)}`;
            }
            parent = parent.parentElement;
          }
          return null;
        }

        function getContainerPath(el) {
          const parts = [];
          let current = el;
          while (current && current !== document.body && parts.length < 3) {
            let part = current.tagName.toLowerCase();
            if (current.id) {
              part += `#${current.id}`;
              parts.unshift(part);
              break;
            }
            const cls = Array.from(current.classList).slice(0, 2).join('.');
            if (cls) part += `.${cls}`;
            parts.unshift(part);
            current = current.parentElement;
          }
          return parts.join('>');
        }

        // Helper: get human-readable context description
        function getContextLabel(el, groupKey) {
          if (groupKey) {
            const type = groupKey.split('::')[0];
            const names = {
              '.ce_gallery': 'Contao Galerie',
              '.ce_slider': 'Contao Slider',
              '.swiper': 'Swiper Slider',
              '.slick-list': 'Slick Slider',
              list: 'Bild-Liste',
              '.gallery': 'Galerie',
              '.slider': 'Slider',
            };
            return `Gruppe: ${names[type] || type}`;
          }
          // Find nearest meaningful parent
          let parent = el.parentElement;
          for (let i = 0; i < 6; i++) {
            if (!parent || parent === document.body) break;
            const tag = parent.tagName.toLowerCase();
            const cls = Array.from(parent.classList).slice(0, 3).join(', .');
            if (
              cls &&
              (tag === 'article' ||
                tag === 'section' ||
                tag === 'main' ||
                cls.includes('ce_') ||
                cls.includes('mod_') ||
                cls.includes('content'))
            ) {
              return `In .${cls}`;
            }
            parent = parent.parentElement;
          }
          return 'Eigenständiges Bild';
        }

        // Collect all img elements
        const imgs = Array.from(document.querySelectorAll('img'));

        for (const img of imgs) {
          const rect = img.getBoundingClientRect();
          const clientWidth = img.clientWidth || Math.round(rect.width);
          const clientHeight = img.clientHeight || Math.round(rect.height);

          // Skip invisible, tiny, or icon-sized images
          if (clientWidth < 50 || clientHeight < 10) continue;
          // Skip tracking pixels, spacers
          const src = img.src || img.dataset.src || '';
          if (!src || src.includes('data:') || src.includes('spacer')) continue;

          const groupKey = getGroupKey(img);
          const selector = getSelector(img);

          // Generate stable key for cross-viewport tracking
          const stableKey = groupKey
            ? `group::${groupKey}`
            : `img::${src.split('?')[0].replace(/^.*\//, '').replace(/\.[^.]+$/, '')}::${selector}`;

          results.push({
            stableKey,
            groupKey,
            src: src.length > 200 ? src.substring(0, 200) : src,
            srcset: img.srcset || '',
            alt: img.alt || '',
            selector,
            contextLabel: getContextLabel(img, groupKey),
            clientWidth,
            clientHeight,
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
            loading: img.loading,
            isLazy: img.loading === 'lazy' || !!img.dataset.src,
          });
        }

        // Also check <picture> source elements (get the img inside)
        const pictures = Array.from(document.querySelectorAll('picture img'));
        for (const img of pictures) {
          const found = results.find((r) => r.selector === getSelector(img));
          if (found) {
            found.inPicture = true;
          }
        }

        return results;
      });

      // Count group sizes (multiple imgs share same stableKey for groups)
      const groupCounts = {};
      for (const img of images) {
        groupCounts[img.stableKey] = (groupCounts[img.stableKey] || 0) + 1;
      }

      // Merge into allMeasurements (only first occurrence per stableKey per viewport)
      const seenThisVp = new Set();
      for (const img of images) {
        if (!allMeasurements.has(img.stableKey)) {
          allMeasurements.set(img.stableKey, {
            meta: {
              stableKey: img.stableKey,
              groupKey: img.groupKey,
              src: img.src,
              srcset: img.srcset,
              alt: img.alt,
              selector: img.selector,
              contextLabel: img.contextLabel,
              naturalWidth: img.naturalWidth,
              naturalHeight: img.naturalHeight,
              loading: img.loading,
              isLazy: img.isLazy,
              inPicture: img.inPicture,
              isGroup: !!img.groupKey,
              groupCount: groupCounts[img.stableKey] || 1,
            },
            measurements: {},
          });
        }
        // Only record first occurrence per viewport (first image in group)
        if (!seenThisVp.has(img.stableKey)) {
          seenThisVp.add(img.stableKey);
          allMeasurements.get(img.stableKey).measurements[vpWidth] = {
            width: img.clientWidth,
            height: img.clientHeight,
          };
        }
      }

      await context.close();
    }

    return Array.from(allMeasurements.values());
  } finally {
    await browser.close();
  }
}
