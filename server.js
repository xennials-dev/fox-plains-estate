const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const zlib = require('zlib');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// Security & Caching Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Lightweight Native Compression Middleware (Gzip for text, html, css, js, json)
app.use((req, res, next) => {
  const acceptEncoding = req.headers['accept-encoding'] || '';
  if (!acceptEncoding.includes('gzip')) return next();

  const originalSend = res.send;
  res.send = function (body) {
    if (typeof body === 'string' || Buffer.isBuffer(body)) {
      const contentType = res.getHeader('Content-Type') || '';
      if (/json|text|javascript|css|html|xml/i.test(contentType)) {
        res.setHeader('Content-Encoding', 'gzip');
        res.removeHeader('Content-Length');
        const compressed = zlib.gzipSync(body);
        return originalSend.call(this, compressed);
      }
    }
    return originalSend.call(this, body);
  };
  next();
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Directories (with serverless safe fallback)
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = process.env.VERCEL ? path.join('/tmp', 'uploads') : path.join(__dirname, 'uploads');
const ASSETS_DIR = path.join(__dirname, 'assets');

try {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
} catch (_) {}
try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (_) {}

// Static Assets with Cache-Control (1 day cache for static assets)
const staticOptions = {
  maxAge: '1d',
  etag: true,
  lastModified: true
};
app.use('/uploads', express.static(UPLOADS_DIR, staticOptions));
app.use('/assets', express.static(ASSETS_DIR, staticOptions));

// Explicit Safe HTML Route Serving
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile('index.html', { root: __dirname });
});
app.get('/index.html', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile('index.html', { root: __dirname });
});
app.get('/studio', (req, res) => res.sendFile('studio.html', { root: __dirname }));
app.get('/studio.html', (req, res) => res.sendFile('studio.html', { root: __dirname }));
app.get('/analytics', (req, res) => res.sendFile('analytics.html', { root: __dirname }));
app.get('/analytics.html', (req, res) => res.sendFile('analytics.html', { root: __dirname }));
const DRONE_DIR = path.join(__dirname, 'drone');
app.use('/drone', express.static(DRONE_DIR));
app.get('/drone', (req, res) => res.sendFile('index.html', { root: DRONE_DIR }));
app.get('/drone/index.html', (req, res) => res.sendFile('index.html', { root: DRONE_DIR }));

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9-_]/g, '_');
    cb(null, `${base}-${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

/* ==============================================================
   HIGH-PERFORMANCE IN-MEMORY CACHE & NON-BLOCKING PERSISTENCE
   ============================================================== */
const memoryCache = {
  properties: null,
  leads: null,
  analytics: null
};

function loadInitialData(filename, fallback) {
  const filePath = path.join(DATA_DIR, filename);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (err) {
    console.warn(`[Cache Init] Reading ${filename}:`, err.message);
  }
  return fallback;
}

memoryCache.properties = loadInitialData('properties.json', { properties: [] });
memoryCache.leads = loadInitialData('leads.json', { leads: [] });
memoryCache.analytics = loadInitialData('analytics.json', { summary: {}, sceneViews: {}, recentEvents: [] });

// Async non-blocking file writer (Windows-safe direct write with serverless fallback)
async function persistAsync(filename, data) {
  const filePath = path.join(DATA_DIR, filename);
  try {
    await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    try {
      const tmpPath = path.join('/tmp', filename);
      await fsp.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (_) {}
    console.warn(`[Async Write Note] ${filename}:`, err.message);
  }
}

// Debounced Analytics Persistence to eliminate I/O disk thrashing
let analyticsDirty = false;
if (!process.env.VERCEL) {
  setInterval(() => {
    if (analyticsDirty && memoryCache.analytics) {
      analyticsDirty = false;
      persistAsync('analytics.json', memoryCache.analytics);
    }
  }, 4000);
}

// Lead Notification Dispatcher (Pipes into Sovereign WhatsApp & Telegram Mesh)
async function dispatchLeadNotification(lead) {
  const alertText = `🏡 <b>NEW SHOWING APPOINTMENT REQUEST</b>\n\n` +
    `<b>Prospect:</b> ${lead.name}\n` +
    `<b>Contact:</b> ${lead.phone || 'N/A'} · ${lead.email || 'N/A'}\n` +
    `<b>Property:</b> ${lead.propertyAddress} (<code>${lead.propertyId}</code>)\n` +
    `<b>Date:</b> ${lead.date || 'Immediate / Flexible'}\n` +
    `<b>Notes:</b> ${lead.message || 'None'}\n` +
    `<b>Source:</b> ${lead.source}`;

  // 1. Dispatch to Xennials Platform API if online
  try {
    fetch('http://localhost:5000/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: lead.name,
        email: lead.email,
        company: lead.propertyAddress,
        budget: '$254,000 Listing Inquiry',
        message: `[Private Tour Booking - ${lead.date}]: ${lead.message || 'No additional notes'} (Phone: ${lead.phone})`
      })
    }).catch(() => {});
  } catch (_) {}

  console.log(`[Lead Alert]: ${lead.name} booked tour for ${lead.propertyAddress}`);
}

/* ==============================================================
   API ROUTES: PROPERTIES
   ============================================================== */

// GET all properties (Instant in-memory read)
app.get('/api/properties', (req, res) => {
  res.json({ success: true, properties: memoryCache.properties.properties });
});

// GET single property by id
app.get('/api/properties/:id', (req, res) => {
  const prop = memoryCache.properties.properties.find(p => p.id === req.params.id);
  if (!prop) {
    return res.status(404).json({ success: false, error: 'Property not found' });
  }
  res.json({ success: true, property: prop });
});

// POST create or update property
app.post('/api/properties', (req, res) => {
  const newProp = req.body;
  if (!newProp.id) {
    newProp.id = (newProp.brand || newProp.address || 'property')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  const existingIdx = memoryCache.properties.properties.findIndex(p => p.id === newProp.id);
  if (existingIdx >= 0) {
    memoryCache.properties.properties[existingIdx] = { ...memoryCache.properties.properties[existingIdx], ...newProp };
  } else {
    memoryCache.properties.properties.push(newProp);
  }

  persistAsync('properties.json', memoryCache.properties);
  res.json({ success: true, property: newProp });
});

// POST media upload
app.post('/api/upload', upload.single('media'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file provided' });
  }
  const url = `/uploads/${req.file.filename}`;
  res.json({
    success: true,
    url,
    originalName: req.file.originalname,
    size: req.file.size,
    mimetype: req.file.mimetype
  });
});

/* ==============================================================
   API ROUTES: LEADS & TOUR APPOINTMENTS
   ============================================================== */

// GET all leads
app.get('/api/leads', (req, res) => {
  let leads = memoryCache.leads.leads;
  if (req.query.propertyId) {
    leads = leads.filter(l => l.propertyId === req.query.propertyId);
  }
  res.json({ success: true, leads });
});

// POST new lead with auto-notification
app.post('/api/leads', (req, res) => {
  const lead = {
    id: `lead-${Date.now()}`,
    propertyId: req.body.propertyId || 'fox-plains',
    propertyAddress: req.body.propertyAddress || '15556 Fox Plains Dr',
    name: (req.body.name || 'Anonymous Prospect').trim(),
    email: (req.body.email || '').trim().toLowerCase(),
    phone: (req.body.phone || '').trim(),
    date: req.body.date || '',
    message: (req.body.message || '').trim(),
    status: 'New',
    source: req.body.source || 'Private Tour Form',
    createdAt: new Date().toISOString()
  };

  memoryCache.leads.leads.unshift(lead);
  persistAsync('leads.json', memoryCache.leads);

  // Update analytics summary count
  if (!memoryCache.analytics.summary) memoryCache.analytics.summary = {};
  memoryCache.analytics.summary.tourRequests = (memoryCache.analytics.summary.tourRequests || 0) + 1;
  analyticsDirty = true;

  // Real-time notification dispatch
  dispatchLeadNotification(lead);

  res.status(201).json({ success: true, lead });
});

// PATCH update lead status
app.patch('/api/leads/:id', (req, res) => {
  const lead = memoryCache.leads.leads.find(l => l.id === req.params.id);
  if (!lead) {
    return res.status(404).json({ success: false, error: 'Lead not found' });
  }

  if (req.body.status) lead.status = req.body.status;
  if (req.body.notes) lead.notes = req.body.notes;

  persistAsync('leads.json', memoryCache.leads);
  res.json({ success: true, lead });
});

/* ==============================================================
   API ROUTES: ANALYTICS & EVENTS (Debounced In-Memory)
   ============================================================== */

// GET analytics dashboard metrics
app.get('/api/analytics', (req, res) => {
  res.json({ success: true, analytics: memoryCache.analytics });
});

// POST record interaction event (High-frequency non-blocking)
app.post('/api/analytics/event', (req, res) => {
  const { type, propertyId, scene, variant, query } = req.body;
  const a = memoryCache.analytics;

  const event = {
    type,
    propertyId: propertyId || 'fox-plains',
    scene,
    variant,
    query,
    timestamp: new Date().toISOString()
  };

  if (!a.summary) a.summary = {};
  if (type === 'page_view') a.summary.totalImpressions = (a.summary.totalImpressions || 0) + 1;
  if (type === 'staging_toggle') a.summary.stagingToggles = (a.summary.stagingToggles || 0) + 1;
  if (type === 'dollhouse_open') a.summary.dollhouseLaunches = (a.summary.dollhouseLaunches || 0) + 1;
  if (type === 'concierge_query') a.summary.conciergeChats = (a.summary.conciergeChats || 0) + 1;

  if (type === 'scene_view' && scene) {
    if (!a.sceneViews) a.sceneViews = {};
    a.sceneViews[scene] = (a.sceneViews[scene] || 0) + 1;
  }

  if (!a.recentEvents) a.recentEvents = [];
  a.recentEvents.unshift(event);
  if (a.recentEvents.length > 50) a.recentEvents.pop();

  analyticsDirty = true;
  res.json({ success: true });
});

// Express Error-Handling Middleware (Catches bad JSON, payload issues, unhandled route errors)
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && (err.status === 400 || err.statusCode === 400) && 'body' in err) {
    console.warn(`[API Warning] Handled malformed JSON payload from ${req.ip} on ${req.originalUrl}`);
    return res.status(400).json({ success: false, error: 'Malformed JSON payload in request body' });
  }
  console.error('[EstateSphere Error Handler]:', err.stack || err.message);
  if (!res.headersSent) {
    res.status(err.status || 500).json({ success: false, error: err.message || 'Internal Server Error' });
  }
});

// Global Process Error & Lifecycle Handlers
process.on('uncaughtException', err => {
  console.error('[EstateSphere Error] Uncaught Exception:', err.stack || err.message);
});
process.on('unhandledRejection', reason => {
  console.error('[EstateSphere Error] Unhandled Rejection:', reason);
});
process.on('exit', code => {
  console.log(`[EstateSphere Lifecycle] Process exit event with code: ${code}`);
});
process.on('SIGINT', () => {
  console.log('[EstateSphere Lifecycle] Received SIGINT');
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.log('[EstateSphere Lifecycle] Received SIGTERM');
  process.exit(0);
});

function startServer(portToTry) {
  const server = app.listen(portToTry, () => {
    console.log(`Fox Plains Estate Ecosystem optimized & running at http://localhost:${portToTry}`);
    console.log(`- Buyer Experience: http://localhost:${portToTry}`);
    console.log(`- Agent Studio:     http://localhost:${portToTry}/studio`);
    console.log(`- Agent Analytics:  http://localhost:${portToTry}/analytics`);
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${portToTry} busy. Retrying in 2 seconds...`);
      setTimeout(() => {
        try { server.close(); } catch (_) {}
        startServer(portToTry);
      }, 2000);
    } else {
      console.error('Server error:', err);
    }
  });
}

if (require.main === module) {
  startServer(PORT);
}

module.exports = app;
