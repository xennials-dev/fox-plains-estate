const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const multer = require('multer');
const { SovereignStore } = require('./lib/sovereignStore');

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

// Sovereign Single-VPS Directories (Permanent disk storage by default)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = process.env.UPLOADS_DIR || (process.env.VERCEL ? path.join('/tmp', 'uploads') : path.join(__dirname, 'uploads'));
const ASSETS_DIR = path.join(__dirname, 'assets');

try {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
} catch (_) {}
try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (_) {}

const sovereignStore = new SovereignStore({ dataDir: DATA_DIR, uploadsDir: UPLOADS_DIR });

/* ==============================================================
   OPTION A: AUTHENTICATION & RBAC MIDDLEWARE
   ============================================================== */
function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  raw.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const k = pair.slice(0, idx).trim();
      const v = decodeURIComponent(pair.slice(idx + 1).trim());
      out[k] = v;
    }
  });
  return out;
}

function resolveAuthContext(req) {
  const cookies = parseCookies(req);
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const headerKey = (req.headers['x-estatesphere-key'] || '').trim();
  const queryToken = (req.query.token || req.query.clientToken || '').trim();
  const propertyId = (req.query.propertyId || req.body?.propertyId || '').trim();

  const tokenCandidate = headerKey || bearer || cookies.es_session || queryToken;
  const verified = sovereignStore.verifyToken(tokenCandidate);
  if (verified) return verified;

  // Check if a Done-For-You Realtor Client is using their scoped share token
  if (propertyId && queryToken && sovereignStore.verifyClientShareToken(propertyId, queryToken)) {
    return { role: 'client', scope: propertyId };
  }

  // Allow local operator session unless STRICT_AUTH=true is set on public edge
  const enforceStrict = process.env.STRICT_AUTH === 'true';
  if (!enforceStrict) {
    return { role: 'operator', scope: 'all', mode: 'sovereign-local' };
  }
  return null;
}

function requireOperatorAuth(req, res, next) {
  const auth = resolveAuthContext(req);
  if (!auth || auth.role !== 'operator') {
    return res.status(401).json({
      success: false,
      error: 'Operator authentication required. Sign in with your Solopreneur Master Key.'
    });
  }
  req.auth = auth;
  next();
}

function requireReadAuthOrClientScope(req, res, next) {
  const auth = resolveAuthContext(req);
  if (!auth) {
    return res.status(401).json({
      success: false,
      error: 'Authentication or valid Client Share Token required.'
    });
  }
  req.auth = auth;
  next();
}

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
app.use('/drone', express.static(DRONE_DIR, staticOptions));
app.get('/drone', (req, res) => {
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(301, `/drone/${qs}`);
});
app.get('/drone/', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile('index.html', { root: DRONE_DIR });
});
app.get('/drone/index.html', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile('index.html', { root: DRONE_DIR });
});

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
   HIGH-PERFORMANCE IN-MEMORY CACHE & SOVEREIGN PERSISTENCE
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
memoryCache.analytics = loadInitialData('analytics.json', {
  summary: {},
  byProperty: {},
  sceneViews: {},
  recentEvents: []
});

async function persistAsync(filename, data) {
  const collectionName = path.basename(filename, '.json');
  await sovereignStore.persistCollection(filename, collectionName, data);
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
  const webhookUrl = process.env.CRM_WEBHOOK_URL;
  if (webhookUrl) {
    try {
      fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: lead.name,
          email: lead.email,
          company: lead.propertyAddress,
          budget: `${lead.propertyId} Listing Inquiry`,
          message: `[Private Tour Booking - ${lead.date}]: ${lead.message || 'No additional notes'} (Phone: ${lead.phone})`
        })
      }).catch(() => {});
    } catch (_) {}
  }

  console.log(`[Lead Alert]: ${lead.name} booked tour for ${lead.propertyAddress}`);
}

/* ==============================================================
   API ROUTES: AUTHENTICATION & SOVEREIGN AGENCY ACCESS
   ============================================================== */

app.post('/api/auth/login', (req, res) => {
  const { passcode, propertyId, clientToken } = req.body || {};

  if (passcode && passcode === sovereignStore.masterKey) {
    const token = sovereignStore.issueToken({ role: 'operator', scope: 'all' });
    res.setHeader('Set-Cookie', `es_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
    return res.json({
      success: true,
      role: 'operator',
      scope: 'all',
      token,
      storage: sovereignStore.getStorageStatus()
    });
  }

  if (propertyId && clientToken && sovereignStore.verifyClientShareToken(propertyId, clientToken)) {
    const token = sovereignStore.issueToken({ role: 'client', scope: propertyId });
    res.setHeader('Set-Cookie', `es_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
    return res.json({
      success: true,
      role: 'client',
      scope: propertyId,
      token
    });
  }

  return res.status(401).json({
    success: false,
    error: 'Invalid Operator Master Key or Client Token'
  });
});

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'es_session=; Path=/; HttpOnly; Max-Age=0');
  res.json({ success: true });
});

app.get('/api/auth/session', (req, res) => {
  const auth = resolveAuthContext(req);
  const propId = req.query.propertyId || 'fox-plains';
  res.json({
    success: true,
    authenticated: Boolean(auth),
    auth: auth || { role: 'guest', scope: 'none' },
    strictAuthEnforced: process.env.STRICT_AUTH === 'true',
    storage: sovereignStore.getStorageStatus(),
    clientShareToken: auth && auth.role === 'operator' ? sovereignStore.getClientShareToken(propId) : null
  });
});

/* ==============================================================
   API ROUTES: PROPERTIES & AGENCY PROVISIONING
   ============================================================== */

// GET all properties (Instant in-memory read, scoped if client role)
app.get('/api/properties', (req, res) => {
  const auth = resolveAuthContext(req);
  let list = memoryCache.properties.properties || [];
  if (auth && auth.role === 'client' && auth.scope && auth.scope !== 'all') {
    list = list.filter(p => p.id === auth.scope);
  }
  res.json({ success: true, properties: list });
});

// GET single property by id (or custom domain lookup)
app.get('/api/properties/:id', (req, res) => {
  const target = req.params.id.toLowerCase();
  const prop = memoryCache.properties.properties.find(
    p => p.id === target || (p.customDomain && p.customDomain.toLowerCase() === target)
  );
  if (!prop) {
    return res.status(404).json({ success: false, error: 'Property not found' });
  }
  res.json({
    success: true,
    property: prop,
    clientShareToken: sovereignStore.getClientShareToken(prop.id)
  });
});

// POST create or update property (Protected by Operator RBAC)
app.post('/api/properties', requireOperatorAuth, (req, res) => {
  const newProp = req.body;
  if (!newProp.id) {
    newProp.id = (newProp.brand || newProp.address || 'property')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  const existingIdx = memoryCache.properties.properties.findIndex(p => p.id === newProp.id);
  if (existingIdx >= 0) {
    memoryCache.properties.properties[existingIdx] = {
      ...memoryCache.properties.properties[existingIdx],
      ...newProp,
      updatedAt: new Date().toISOString()
    };
  } else {
    newProp.createdAt = new Date().toISOString();
    memoryCache.properties.properties.push(newProp);
  }

  persistAsync('properties.json', memoryCache.properties);
  res.json({
    success: true,
    property: newProp,
    clientShareUrl: `/analytics?propertyId=${encodeURIComponent(newProp.id)}&clientToken=${sovereignStore.getClientShareToken(newProp.id)}`
  });
});

// DELETE property from inventory (Protected by Operator RBAC)
app.delete('/api/properties/:id', requireOperatorAuth, (req, res) => {
  const idx = memoryCache.properties.properties.findIndex(p => p.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ success: false, error: 'Property not found' });
  }
  if (memoryCache.properties.properties.length <= 1) {
    return res.status(400).json({ success: false, error: 'Cannot delete the last remaining showcase property.' });
  }
  const [removed] = memoryCache.properties.properties.splice(idx, 1);
  persistAsync('properties.json', memoryCache.properties);
  res.json({ success: true, removedId: removed.id });
});

// POST Done-For-You Agency Webhook Provisioner (Kill Bill / Stripe / Activepieces / OpenMausBot)
app.post('/api/webhooks/provision', requireOperatorAuth, (req, res) => {
  const {
    brand,
    address,
    city = 'St. Louis, Missouri',
    price = '$495,000',
    mls = 'MLS# Pending',
    beds = '4',
    baths = '3',
    sqft = '2,650 sq ft',
    lot = '0.32 acres',
    lower = 'Finished Walkout',
    garage = '2-car attached',
    agentName = 'Ava Marchetti',
    agentTitle = 'Senior Listing Partner',
    agentPhone = '(314) 555-0194',
    agentEmail = 'ava@marchettiestates.com',
    broker = 'Marchetti Real Estate Partners',
    customDomain = ''
  } = req.body || {};

  if (!address && !brand) {
    return res.status(400).json({ success: false, error: 'address or brand is required to provision a microsite.' });
  }

  const slug = (brand || address)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  const copy = synthesizeLuxuryListingCopy({ brand: brand || address, address, city, price, beds, baths, sqft, lot, lower, garage });
  const baseTemplate = memoryCache.properties.properties[0] || {};

  const provisionedProperty = {
    ...baseTemplate,
    id: slug,
    brand: brand || address.split(' ').slice(1, 3).join(' ') || address,
    address: address || brand,
    city,
    price,
    status: 'Active',
    mls,
    broker,
    customDomain,
    headline: copy.headline,
    lede: copy.lede,
    agent: {
      name: agentName,
      title: agentTitle,
      phone: agentPhone,
      email: agentEmail
    },
    specs: [
      { k: 'Bedrooms', v: String(beds) },
      { k: 'Bathrooms', v: String(baths) },
      { k: 'Interior', v: String(sqft) },
      { k: 'Lower Level', v: String(lower) },
      { k: 'Lot Size', v: String(lot) },
      { k: 'Garage', v: String(garage) }
    ],
    scenes: copy.scenes,
    createdAt: new Date().toISOString()
  };

  const existingIdx = memoryCache.properties.properties.findIndex(p => p.id === slug);
  if (existingIdx >= 0) {
    memoryCache.properties.properties[existingIdx] = provisionedProperty;
  } else {
    memoryCache.properties.properties.push(provisionedProperty);
  }

  persistAsync('properties.json', memoryCache.properties);

  const clientShareToken = sovereignStore.getClientShareToken(slug);
  res.status(201).json({
    success: true,
    property: provisionedProperty,
    links: {
      buyerMicrosite: `/?id=${slug}`,
      droneTwin: `/drone/?id=${slug}`,
      agentStudio: `/studio?id=${slug}`,
      clientAnalyticsPortal: `/analytics?propertyId=${slug}&clientToken=${clientShareToken}`
    },
    outreachPitch: copy.outreachPitch
  });
});

// POST media upload (Permanent Local Disk + MinIO Object Storage Mirror)
app.post('/api/upload', requireOperatorAuth, upload.single('media'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file provided' });
  }
  const storageMeta = await sovereignStore.registerUpload(req.file);
  res.json({
    success: true,
    url: storageMeta.url,
    localFallbackUrl: storageMeta.localFallbackUrl || `/uploads/${req.file.filename}`,
    storageProvider: storageMeta.storageProvider,
    originalName: req.file.originalname,
    size: req.file.size,
    mimetype: req.file.mimetype
  });
});

/* ==============================================================
   OPTION C: SOVEREIGN LLM CONCIERGE & AI COPYWRITER ENGINE
   ============================================================== */

function synthesizeLuxuryListingCopy({ brand, address, city, price, beds, baths, sqft, lot, lower, garage }) {
  const propTitle = brand || address || 'The Residence';
  const headline = `An architectural sanctuary of light, proportion, and effortless indoor-outdoor living in ${city.split(',')[0] || 'Missouri'}.`;
  const lede = `Privately positioned on a ${lot || 'manicured'} parcel at ${address || propTitle}, this ${beds}-bedroom, ${baths}-bath residence spans ${sqft} of thoughtfully curated living space. Anchored by sun-drenched gathering areas, ${lower || 'a versatile lower level'}, and ${garage || 'private garaging'}, the estate balances timeless craftsmanship with turnkey modern comfort.`;

  const scenes = [
    {
      id: 'orbit',
      label: 'Aerial Orbit',
      kicker: '00 — Aerial Context',
      title: `${propTitle}, From Above`,
      copy: `An opening high-altitude orbit over ${address || propTitle} in ${city}, showcasing mature canopy, quiet streets, and a ${lot || 'generous'} footprint.`,
      poster: '/assets/img/aerial.jpg',
      video: ''
    },
    {
      id: 'fpv',
      label: 'Flythrough',
      kicker: '01 — Continuous FPV',
      title: 'Driveway to Terrace, One Continuous Take',
      copy: `Gliding from the front approach of ${address || propTitle} through the main entry and out toward the private rear grounds.`,
      poster: '/assets/img/exterior-day.jpg',
      video: ''
    },
    {
      id: 'living',
      label: 'Living Room',
      kicker: '02 — The Living Room',
      title: 'Natural Light & Architectural Warmth',
      copy: `Expansive sightlines across ${sqft} of main-level living space, framed by picture windows and warm hardwood textures.`,
      poster: '/assets/img/living.jpg',
      video: ''
    },
    {
      id: 'kitchen',
      label: 'Kitchen',
      kicker: '03 — Culinary Hub',
      title: 'Tailored for Gathering & Daily Ritual',
      copy: 'Custom cabinetry, stone countertops, and an inviting breakfast area overlooking the landscaped rear yard.',
      poster: '/assets/img/kitchen.jpg',
      video: ''
    },
    {
      id: 'bedroom',
      label: 'Primary Bedroom',
      kicker: '04 — Primary Retreat',
      title: 'Quiet Scale & Serene Garden Views',
      copy: `One of ${beds} generously scaled bedrooms, offering private sightlines and refined bath appointments.`,
      poster: '/assets/img/bedroom.jpg',
      video: ''
    },
    {
      id: 'lower',
      label: 'Lower Level',
      kicker: '05 — Lower Level Suite',
      title: `${lower || 'Flexible Entertainment & Lounge Wing'}`,
      copy: 'Dedicated recreation, media, and home-office flexibility designed for multi-generational living or hosting.',
      poster: '/assets/img/lower-level.jpg',
      video: ''
    },
    {
      id: 'backyard',
      label: 'Backyard',
      kicker: '06 — Outdoor Sanctuary',
      title: `A Private ${lot || 'Estate'} Setting`,
      copy: 'Patio entertaining zones, shade trees, and level lawn ready for summer gatherings around the fire.',
      poster: '/assets/img/backyard.jpg',
      video: ''
    },
    {
      id: 'dusk',
      label: 'Evening',
      kicker: '07 — Twilight Elevation',
      title: 'Warm Illumination at Dusk',
      copy: `As evening settles over ${city.split(',')[0] || 'the neighborhood'}, every window of ${address || propTitle} glows with welcoming character.`,
      poster: '/assets/img/exterior-dusk.jpg',
      video: ''
    }
  ];

  const slug = (brand || address || 'fox-plains')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  const outreachPitch =
    `Hi — I noticed your listing at ${address || propTitle} (${price || ''}) and built a live, interactive 3D Drone & AI Concierge showcase specifically for it.\n\n` +
    `• Live Scroll Film & Virtual Staging: /?id=${slug}\n` +
    `• Interactive 3D FPV Drone Twin: /drone/?id=${slug}\n\n` +
    `Your contact card and private showing form are already wired in. Let me know if you'd like the custom domain and weekly seller analytics report activated for your homeowner!`;

  return { headline, lede, scenes, outreachPitch };
}

async function querySovereignLLM(messages, jsonMode = false) {
  const apiUrl = process.env.LLM_API_URL || 'http://127.0.0.1:11434/v1/chat/completions';
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || 'ollama';
  const model = process.env.LLM_MODEL || 'llama3.2';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);

  try {
    const body = {
      model,
      messages,
      temperature: 0.4,
      max_tokens: 600
    };
    if (jsonMode) body.response_format = { type: 'json_object' };

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    return content ? content.trim() : null;
  } catch (_) {
    clearTimeout(timeout);
    return null;
  }
}

// POST /api/studio/generate-copy — AI Copywriter for Studio & Spec-Site Outreach
app.post('/api/studio/generate-copy', requireOperatorAuth, async (req, res) => {
  const params = req.body || {};
  const fallback = synthesizeLuxuryListingCopy(params);

  const systemPrompt =
    `You are an elite architectural real estate copywriter for a Done-For-You Luxury Listing Agency. ` +
    `Return ONLY valid JSON with keys: "headline" (string, max 16 words), "lede" (string, 2-3 sentences), and "outreachPitch" (short cold message to the listing agent pitching the live spec microsite).`;

  const userPrompt =
    `Property Details:\n` +
    `Brand/Title: ${params.brand || ''}\n` +
    `Address: ${params.address || ''}, ${params.city || ''}\n` +
    `Price: ${params.price || ''}\n` +
    `Specs: ${params.beds || 3} Beds, ${params.baths || 2} Baths, ${params.sqft || ''} Interior, ${params.lot || ''} Lot, ${params.lower || ''} Lower Level, ${params.garage || ''} Garage.`;

  const llmRaw = await querySovereignLLM(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    true
  );

  if (llmRaw) {
    try {
      const parsed = JSON.parse(llmRaw);
      return res.json({
        success: true,
        provider: 'sovereign-llm',
        headline: parsed.headline || fallback.headline,
        lede: parsed.lede || fallback.lede,
        scenes: fallback.scenes,
        outreachPitch: parsed.outreachPitch || fallback.outreachPitch
      });
    } catch (_) {}
  }

  return res.json({
    success: true,
    provider: 'architectural-synthesizer',
    ...fallback
  });
});

// POST /api/concierge/chat — Live RAG Property Concierge Endpoint
app.post('/api/concierge/chat', async (req, res) => {
  const { propertyId = 'fox-plains', query = '', history = [] } = req.body || {};
  const cleanQuery = String(query).trim();
  if (!cleanQuery) {
    return res.status(400).json({ success: false, error: 'Query is required' });
  }

  const prop =
    memoryCache.properties.properties.find(p => p.id === propertyId) ||
    memoryCache.properties.properties[0];

  // Record analytics event
  recordAnalyticsEvent({
    type: 'concierge_query',
    propertyId: prop ? prop.id : propertyId,
    query: cleanQuery
  });

  if (!prop) {
    return res.json({
      success: true,
      reply: 'Please contact our listing partner directly to schedule a private showing.'
    });
  }

  // 1. Attempt Live Sovereign LLM (Ollama / LiteLLM / OpenAI-compatible) Grounded RAG
  const kbFacts = (prop.knowledge || [])
    .map(k => `- [${(k.triggers || []).join(', ')}]: ${String(k.response).replace(/<[^>]+>/g, ' ')}`)
    .join('\n');
  const specsList = (prop.specs || []).map(s => `${s.k}: ${s.v}`).join(', ');

  const systemPrompt =
    `You are the dedicated AI Property Concierge for ${prop.address}, ${prop.city} (${prop.brand}), offered at ${prop.price} (${prop.mls}).\n` +
    `Listing Agent: ${prop.agent?.name || 'Ava Marchetti'} (${prop.agent?.title || ''}) · Phone: ${prop.agent?.phone || ''} · Email: ${prop.agent?.email || ''} · Brokerage: ${prop.broker || ''}.\n` +
    `Headline: ${prop.headline}\n` +
    `Overview: ${prop.lede}\n` +
    `Key Specs: ${specsList}\n` +
    `Verified Property Knowledge Base:\n${kbFacts}\n\n` +
    `Rules: Answer the prospective buyer's question accurately, concisely (2-4 sentences or bullet points using HTML <b> and <br> tags), and warmly invite them to book a private tour with ${prop.agent?.name || 'the listing agent'} if appropriate. Never invent unverified structural facts.`;

  const llmMessages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-4).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 400)
    })),
    { role: 'user', content: cleanQuery }
  ];

  const llmAnswer = await querySovereignLLM(llmMessages, false);
  if (llmAnswer) {
    return res.json({
      success: true,
      provider: 'sovereign-llm',
      reply: llmAnswer
    });
  }

  // 2. Grounded Multi-Intent RAG Synthesizer Fallback (Zero-Latency)
  const lower = cleanQuery.toLowerCase();
  const kb = prop.knowledge || [];
  const matchedItems = kb.filter(item => (item.triggers || []).some(t => lower.includes(t.toLowerCase())));

  if (matchedItems.length > 0) {
    return res.json({
      success: true,
      provider: 'grounded-rag-kb',
      reply: matchedItems.map(m => m.response).join('<br><br>')
    });
  }

  // Check specs or scene questions
  if (/bed|bath|garage|lot|sq\s*ft|square|size|room|spec/i.test(lower)) {
    const specBullets = (prop.specs || []).map(s => `• <b>${s.k}:</b> ${s.v}`).join('<br>');
    return res.json({
      success: true,
      provider: 'grounded-rag-specs',
      reply: `<b>${prop.address} Specifications (${prop.price}):</b><br>${specBullets}<br><br>Would you like to reserve a private walkthrough with <b>${prop.agent?.name || 'Ava Marchetti'}</b>?`
    });
  }

  const agentName = (prop.agent && prop.agent.name) || 'Ava Marchetti';
  const agentPhone = (prop.agent && prop.agent.phone) || '(314) 555-0194';
  const agentEmail = (prop.agent && prop.agent.email) || 'ava@marchettiestates.com';

  return res.json({
    success: true,
    provider: 'grounded-rag-summary',
    reply:
      `<b>${prop.address} (${prop.price})</b> offers ${(prop.specs || []).map(s => `${s.v} ${s.k}`).slice(0, 3).join(' · ')}.<br><br>` +
      `${prop.lede}<br><br>` +
      `For specific disclosures or to arrange a private viewing, connect directly with <b>${agentName}</b> at <a href="tel:${agentPhone.replace(/[^\d+]/g, '')}" style="color:var(--gold);text-decoration:underline">${agentPhone}</a> or <a href="mailto:${agentEmail}" style="color:var(--gold);text-decoration:underline">${agentEmail}</a>.`
  });
});

/* ==============================================================
   API ROUTES: LEADS & TOUR APPOINTMENTS
   ============================================================== */

// GET all leads (Scoped by RBAC for Done-For-You Realtor Clients)
app.get('/api/leads', requireReadAuthOrClientScope, (req, res) => {
  let leads = memoryCache.leads.leads || [];
  const requestedProp = req.query.propertyId;

  if (req.auth && req.auth.role === 'client' && req.auth.scope !== 'all') {
    leads = leads.filter(l => l.propertyId === req.auth.scope);
  } else if (requestedProp && requestedProp !== 'all') {
    leads = leads.filter(l => l.propertyId === requestedProp);
  }
  res.json({ success: true, leads });
});

// POST new lead with auto-notification (Public Buyer Endpoint)
app.post('/api/leads', (req, res) => {
  const propId = req.body.propertyId || 'fox-plains';
  const lead = {
    id: `lead-${Date.now()}`,
    propertyId: propId,
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

  // Update global + per-property analytics summary count
  const a = memoryCache.analytics;
  if (!a.summary) a.summary = {};
  a.summary.tourRequests = (a.summary.tourRequests || 0) + 1;

  if (!a.byProperty) a.byProperty = {};
  if (!a.byProperty[propId]) {
    a.byProperty[propId] = { summary: {}, sceneViews: {} };
  }
  a.byProperty[propId].summary.tourRequests = (a.byProperty[propId].summary.tourRequests || 0) + 1;

  analyticsDirty = true;

  // Real-time notification dispatch
  dispatchLeadNotification(lead);

  res.status(201).json({ success: true, lead });
});

// PATCH update lead status
app.patch('/api/leads/:id', requireReadAuthOrClientScope, (req, res) => {
  const lead = memoryCache.leads.leads.find(l => l.id === req.params.id);
  if (!lead) {
    return res.status(404).json({ success: false, error: 'Lead not found' });
  }

  if (req.auth && req.auth.role === 'client' && req.auth.scope !== lead.propertyId) {
    return res.status(403).json({ success: false, error: 'Forbidden: Lead belongs to another property' });
  }

  if (req.body.status) lead.status = req.body.status;
  if (req.body.notes) lead.notes = req.body.notes;

  persistAsync('leads.json', memoryCache.leads);
  res.json({ success: true, lead });
});

/* ==============================================================
   API ROUTES: ANALYTICS & EVENTS (Per-Property + Portfolio)
   ============================================================== */

function recordAnalyticsEvent({ type, propertyId = 'fox-plains', scene, variant, query }) {
  const a = memoryCache.analytics;
  const event = {
    type,
    propertyId,
    scene,
    variant,
    query,
    timestamp: new Date().toISOString()
  };

  if (!a.summary) a.summary = {};
  if (!a.byProperty) a.byProperty = {};
  if (!a.byProperty[propertyId]) {
    a.byProperty[propertyId] = { summary: {}, sceneViews: {} };
  }
  const pSummary = a.byProperty[propertyId].summary;
  const pScenes = a.byProperty[propertyId].sceneViews;

  if (type === 'page_view') {
    a.summary.totalImpressions = (a.summary.totalImpressions || 0) + 1;
    pSummary.totalImpressions = (pSummary.totalImpressions || 0) + 1;
  }
  if (type === 'staging_toggle') {
    a.summary.stagingToggles = (a.summary.stagingToggles || 0) + 1;
    pSummary.stagingToggles = (pSummary.stagingToggles || 0) + 1;
  }
  if (type === 'dollhouse_open') {
    a.summary.dollhouseLaunches = (a.summary.dollhouseLaunches || 0) + 1;
    pSummary.dollhouseLaunches = (pSummary.dollhouseLaunches || 0) + 1;
  }
  if (type === 'concierge_query') {
    a.summary.conciergeChats = (a.summary.conciergeChats || 0) + 1;
    pSummary.conciergeChats = (pSummary.conciergeChats || 0) + 1;
  }

  if (type === 'scene_view' && scene) {
    if (!a.sceneViews) a.sceneViews = {};
    a.sceneViews[scene] = (a.sceneViews[scene] || 0) + 1;
    pScenes[scene] = (pScenes[scene] || 0) + 1;
  }

  if (!a.recentEvents) a.recentEvents = [];
  a.recentEvents.unshift(event);
  if (a.recentEvents.length > 100) a.recentEvents.pop();

  analyticsDirty = true;
}

// GET analytics dashboard metrics (Supports ?propertyId= filter & RBAC client scope)
app.get('/api/analytics', requireReadAuthOrClientScope, (req, res) => {
  const a = memoryCache.analytics;
  let propFilter = req.query.propertyId || 'all';
  if (req.auth && req.auth.role === 'client' && req.auth.scope !== 'all') {
    propFilter = req.auth.scope;
  }

  if (propFilter && propFilter !== 'all') {
    const propStats = (a.byProperty && a.byProperty[propFilter]) || null;
    const filteredEvents = (a.recentEvents || []).filter(e => e.propertyId === propFilter);
    const propLeadsCount = (memoryCache.leads.leads || []).filter(l => l.propertyId === propFilter).length;

    return res.json({
      success: true,
      propertyId: propFilter,
      clientShareToken: sovereignStore.getClientShareToken(propFilter),
      analytics: {
        summary: propStats && Object.keys(propStats.summary || {}).length > 0
          ? { ...a.summary, ...propStats.summary, tourRequests: propLeadsCount || propStats.summary.tourRequests || a.summary.tourRequests }
          : { ...a.summary, tourRequests: propLeadsCount || a.summary.tourRequests },
        sceneViews: propStats && Object.keys(propStats.sceneViews || {}).length > 0
          ? propStats.sceneViews
          : a.sceneViews,
        recentEvents: filteredEvents
      }
    });
  }

  res.json({
    success: true,
    propertyId: 'all',
    analytics: a
  });
});

// POST record interaction event (High-frequency non-blocking)
app.post('/api/analytics/event', (req, res) => {
  const { type, propertyId, scene, variant, query } = req.body || {};
  recordAnalyticsEvent({
    type,
    propertyId: propertyId || 'fox-plains',
    scene,
    variant,
    query
  });
  res.json({ success: true });
});

// System Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    droneView: true,
    spatial3D: true,
    agentStudio: true,
    sovereignStorage: sovereignStore.getStorageStatus()
  });
});

// Express Error-Handling Middleware
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
