import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { analyzeUrl } from './src/analyzer.js';
import { generateContaoConfig } from './src/contaoMapper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4444;

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// SSE endpoint for streaming progress
const clients = new Map();

function sendProgress(clientId, data) {
  const client = clients.get(clientId);
  if (client) {
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}

app.get('/api/progress/:clientId', (req, res) => {
  const { clientId } = req.params;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  clients.set(clientId, res);
  req.on('close', () => clients.delete(clientId));
});

app.post('/api/analyze', async (req, res) => {
  const { url, viewports = [375, 768, 1200, 1920], clientId } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Validate URL
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  // Parse viewports
  const vps = Array.isArray(viewports)
    ? viewports.map(Number).filter((v) => v > 0 && v <= 3840)
    : [375, 768, 1200, 1920];

  if (vps.length === 0 || vps.length > 8) {
    return res.status(400).json({ error: 'Provide 1-8 viewports between 1 and 3840px' });
  }

  const sorted = [...new Set(vps)].sort((a, b) => a - b);

  console.log(`[Analysis] Starting: ${url} at viewports: ${sorted.join(', ')}`);

  try {
    if (clientId) sendProgress(clientId, { type: 'status', message: 'Browser wird gestartet…', progress: 5 });

    const rawResults = await analyzeUrl(url, sorted);

    if (clientId) sendProgress(clientId, { type: 'status', message: 'Contao-Konfiguration wird berechnet…', progress: 90 });

    const configs = generateContaoConfig(rawResults, sorted);

    if (clientId) sendProgress(clientId, { type: 'status', message: 'Fertig!', progress: 100 });

    console.log(`[Analysis] Done: ${configs.length} image configurations generated`);

    res.json({
      url,
      viewports: sorted,
      timestamp: new Date().toISOString(),
      count: configs.length,
      results: configs,
    });
  } catch (err) {
    console.error('[Analysis] Error:', err.message);
    if (clientId) sendProgress(clientId, { type: 'error', message: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

app.listen(PORT, () => {
  console.log(`\n  ConImageSizer running at http://localhost:${PORT}\n`);
});
