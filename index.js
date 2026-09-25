import recipientRoutes from './routes/recipientRoutes.js';
// Runtime sanity check: ensure this file is loaded from the expected project/server directory structure.
// Misconfiguration (e.g., running `node index.js` at repo root without adjusting rootDir) previously caused
// attempts to resolve './userRoutes.js' from the wrong working directory, leading to ERR_MODULE_NOT_FOUND.
// This guard logs a clear diagnostic if cwd does not contain the package.json for the project root.
import fs from 'fs';
import url from 'url';
try {
  const cwd = process.cwd();
  const expectedPkg = new URL('../package.json', import.meta.url);
  if (!fs.existsSync(expectedPkg)) {
    console.warn('[startup][diagnostic] Expected package.json not found relative to server entry.');
    console.warn('[startup][diagnostic] CWD=', cwd, ' ENTRY=', import.meta.url);
    console.warn('[startup][diagnostic] If deploying on Render, set rootDir: project and startCommand: node server/index.js');
  }
} catch (e) {
  // Non-fatal; purely diagnostic
}
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { errorHandler } from './middleware/errorHandler.js';
import cookieParser from 'cookie-parser';
import cspMiddleware from './middleware/csp.js';

// Route Imports
import userRoutes from './routes/userRoutes.js';
import productRoutes from './routes/productRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import authRoutes from './routes/authRoutes.js';
import heroRoutes from './routes/heroRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import categoryRoutes from './routes/categoryRoutes.js';
import navigationCategoryRoutes from './routes/navigationCategoryRoutes.js';
import deliveryRoutes from './routes/deliveryRoutes.js';
import currencyRoutes from './routes/currencyRoutes.js';
import footerRoutes from './routes/footerRoutes.js';
import announcementRoutes from './routes/announcementRoutes.js';
import announcementMobileRoutes from './routes/announcementMobileRoutes.js';
import announcementWebRoutes from './routes/announcementWebRoutes.js';
import backgroundRoutes from './routes/backgroundRoutes.js';
import bannerRoutes from './routes/bannerRoutes.js';
import mobileBannerRoutes from './routes/mobileBannerRoutes.js';
import inventoryRoutes from './routes/inventoryRoutes.js';
import warehouseRoutes from './routes/warehouseRoutes.js';
import giftCardRoutes from './routes/giftCardRoutes.js';
import couponRoutes from './routes/couponRoutes.js';
import shippingRoutes from './routes/shippingRoutes.js'; // Added Shipping Routes
import revenueRoutes from './routes/revenueRoutes.js'; // Added Revenue Routes
import pushRoutes from './routes/pushRoutes.js';
import whatsappRoutes from './routes/whatsappRoutes.js';
import layoutRoutes from './routes/layoutRoutes.js';
import dbRoutes from './routes/dbRoutes.js';
import dbManager from './services/dbManager.js';
import brandRoutes from './routes/brandRoutes.js';
import cloudinaryRoutes from './routes/cloudinaryRoutes.js';
import paypalRoutes from './routes/paypalRoutes.js';
import legalRoutes from './routes/legalRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';
import paymentsRoutes from './routes/paymentsRoutes.js';
import pageRoutes from './routes/pageRoutes.js';
import translateRoutes from './routes/translateRoutes.js';
import formRoutes from './routes/formRoutes.js';
import cancellationRequestRoutes from './routes/cancellationRequestRoutes.js';
import flashSaleRoutes from './routes/flashSaleRoutes.js';
import bundleOfferRoutes from './routes/bundleOfferRoutes.js';
import attributeRoutes from './routes/attributeRoutes.js';
import posRoutes from './routes/posRoutes.js';
import rivhitRoutes from './routes/rivhitRoutes.js';
import mcgRoutes from './routes/mcgRoutes.js';
import zcreditRoutes from './routes/zcreditRoutes.js';
import zcreditGatewayRoutes from './routes/zcreditGatewayRoutes.js';
import mobilePushRoutes from './routes/mobilePushRoutes.js';
import groomingRoutes from './routes/groomingRoutes.js';
import searchRoutes from './routes/searchRoutes.js';
import googleFeedRoutes from './routes/googleFeedRoutes.js';
import metaFeedRoutes from './routes/metaFeedRoutes.js';
// Lazy import function to warm DeepSeek config from DB
import { loadDeepseekConfigFromDb } from './services/translate/deepseek.js';
import { startPushScheduler } from './services/pushScheduler.js';
import { startMcgSyncScheduler } from './services/mcgSyncScheduler.js';
import { startPaymentSessionJanitor } from './services/paymentSessionJanitor.js';
import { startRetentionCleanup } from './services/retentionCleanup.js';

// Path Setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Environment Variables: load project/.env first, then server/.env to override
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, './.env'), override: true });

const app = express();

// Middleware
// Behind proxies (Render/Netlify/etc.) trust X-Forwarded-* to populate req.ip properly
app.set('trust proxy', true);
// Lightweight request logging & version header
let APP_VERSION = process.env.APP_VERSION || '';
try {
  if (!APP_VERSION) {
    // Attempt to read version from package.json one directory up
    const pkg = await import(path.resolve(__dirname, '../package.json'), { with: { type: 'json' } }).catch(() => null);
    APP_VERSION = pkg?.default?.version || '0.0.0-dev';
  }
} catch {}

app.use((req, res, next) => {
  const start = Date.now();
  const authHeader = req.header('Authorization');
  // Defer logging until response finished
  res.setHeader('X-App-Version', APP_VERSION);
  res.on('finish', () => {
    const duration = Date.now() - start;
    const user = req.user ? `${req.user._id}:${req.user.role}` : 'anon';
    console.log(`REQ ${req.method} ${req.originalUrl} -> ${res.statusCode} ${duration}ms auth=${authHeader? 'y':'n'} user=${user}`);
  });
  next();
});
// Hardened CORS configuration: explicitly allow known storefront/admin origins and handle preflight
const defaultAllowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  'https://relaxed-cucurucho-360448.netlify.app',
  // Self origin (Render) – harmless for health checks and internal tools
  'https://mypet-778751110625.europe-west1.run.app'
];

// Allow override via env (comma-separated list). Merge instead of replace to always keep dev/local origins.
const envOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// Union defaults + env overrides without duplicates
const allowedOrigins = [...new Set([...defaultAllowedOrigins, ...envOrigins])];
const allowedCorsHeaders = [
  'Content-Type',
  'Authorization',
  'X-Requested-With',
  'Accept',
  'Accept-Language',
  'X-Client-Type',
  'X-Client-Platform',
  'X-Refresh-Token',
];

const corsOptions = {
  origin: function(origin, callback) {
    // Allow non-browser requests (no origin) like curl/health checks
    if (!origin) return callback(null, true);
    // Allow any Netlify preview/production subdomain if desired
    const isNetlify = /.netlify\.app$/i.test(origin) || /.netlify\.live$/i.test(origin);
    // Allow any localhost/127.0.0.1 origin regardless of port for development
    try {
      const u = new URL(origin);
      const host = u.hostname;
      if (['localhost', '127.0.0.1', '::1'].includes(host)) {
        return callback(null, true);
      }
      // Allow private LAN IPs during development (e.g., testing from a phone on 192.168.x.x)
      const isPrivateIPv4 = /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
      if (isPrivateIPv4 && process.env.NODE_ENV !== 'production') {
        return callback(null, true);
      }
    } catch {}
    if (allowedOrigins.includes(origin) || isNetlify) {
      return callback(null, true);
    }
    // Enhanced diagnostic: log rejected origin for visibility (will surface in Cloud Run logs)
    console.warn('[cors][reject] origin=', origin, 'allowedOrigins=', allowedOrigins);
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: allowedCorsHeaders,
  // We now rely on httpOnly refresh token cookie (rt) for /api/auth/refresh. Enable credentials.
  credentials: true,
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Reinforce credentials & dynamic origin echo after cors() in case upstream config omits header
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    // Re-run origin allow logic similar to corsOptions.origin
    let allow = false;
    try {
      const u = new URL(origin);
      if (['localhost','127.0.0.1','::1'].includes(u.hostname)) allow = true;
    } catch {}
    const isNetlify = /\.netlify\.(app|live)$/i.test(origin);
    if (!allow && (isNetlify || allowedOrigins.includes(origin))) allow = true;
    if (allow) {
      // Only set ACAO if not already set by cors (avoid header duplication)
      if (!res.getHeader('Access-Control-Allow-Origin')) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      }
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      const vary = res.getHeader('Vary');
      if (!vary) res.setHeader('Vary', 'Origin');
      else if (!String(vary).includes('Origin')) res.setHeader('Vary', vary + ', Origin');
    }
  }
  next();
});

// Apply Content Security Policy middleware
app.use(cspMiddleware);

// Allow larger JSON payloads (city bulk uploads, etc.) without triggering 413 errors
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());
// Serve static for service worker if behind express (especially in production)
const publicDir = path.resolve(__dirname, '../public');
app.use(express.static(publicDir));

const buildZCreditDeepLinkHtml = (params = {}) => {
  const getFirst = (value) => {
    if (Array.isArray(value)) return value[0];
    return value;
  };
  const rawStatus = getFirst(params.status) || 'success';
  const status = String(rawStatus).toLowerCase() === 'cancel' ? 'cancel' : 'success';
  const session = getFirst(params.session) || getFirst(params.sessionId) || '';
  const orderNumber = getFirst(params.order) || getFirst(params.orderNumber) || getFirst(params.orderId) || '';
  const qp = [`status=${encodeURIComponent(status)}`];
  if (session) qp.push(`session=${encodeURIComponent(session)}`);
  if (orderNumber) qp.push(`order=${encodeURIComponent(orderNumber)}`);
  const deepLink = `mypets://zcredit-return?${qp.join('&')}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Payment Result</title>
  <style>
    body { font-family: system-ui, Arial, sans-serif; padding:40px; max-width:600px; margin:auto; }
    h1 { font-size:1.6rem; margin-bottom:.75rem; }
    .box { background:#f8fafc; border:1px solid #e2e8f0; padding:24px; border-radius:12px; }
    .small { font-size:.8rem; color:#64748b; margin-top:32px; }
  </style>
</head>
<body>
  <div class="box">
    <h1>Payment Completed</h1>
    <p>Hold tight, we are sending you back to the app to finalize your order.</p>
    <p class="small">Not redirected automatically? <a href="${deepLink}" rel="noopener">Tap here</a>.</p>
  </div>
  <script>
    setTimeout(function(){ try { window.location.href = ${JSON.stringify(deepLink)}; } catch(e){} }, 200);
  </script>
</body>
</html>`;
};

// Explicit ZCredit mobile success page route so Cloud Run serves it even when static assets are missing
const zcreditSuccessFile = path.join(publicDir, 'zcredit-mobile-success.html');
app.get(['/zcredit-mobile-success', '/zcredit-mobile-success.html'], (req, res, next) => {
  fs.access(zcreditSuccessFile, fs.constants.R_OK, (err) => {
    if (!err) {
      res.sendFile(zcreditSuccessFile, (sendErr) => {
        if (sendErr) next(sendErr);
      });
      return;
    }
    res.status(200).type('html').send(buildZCreditDeepLinkHtml(req.query));
  });
});

// Serve uploaded files with CORS headers to prevent CORB issues
app.use('/uploads', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', allowedCorsHeaders.join(', '));
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(path.resolve(__dirname, '../uploads')));

// MongoDB connection handled by dbManager service

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/hero', heroRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/navigation', navigationCategoryRoutes);
app.use('/api/delivery', deliveryRoutes);
app.use('/api/currency', currencyRoutes);
app.use('/api/footer', footerRoutes);
app.use('/api/announcements', announcementRoutes);
// Segregated mobile/web announcement read-only routes
app.use('/api/mobile/announcements', announcementMobileRoutes);
app.use('/api/web/announcements', announcementWebRoutes);
app.use('/api/backgrounds', backgroundRoutes);
app.use('/api/banners', bannerRoutes);
app.use('/api/mobile-banners', mobileBannerRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/gift-cards', giftCardRoutes);
app.use('/api/recipients', recipientRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/warehouses', warehouseRoutes);
app.use('/api/shipping', shippingRoutes); // Added Shipping Routes
app.use('/api/revenue', revenueRoutes); // Added Revenue Routes
app.use('/api/push', pushRoutes);
app.use('/api/mobile-push', mobilePushRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/layout', layoutRoutes);
app.use('/api/brands', brandRoutes);
app.use('/api/cloudinary', cloudinaryRoutes);
app.use('/api/paypal', paypalRoutes);
app.use('/api/legal', legalRoutes);
app.use('/api/db', dbRoutes);
app.use('/api/payments', paymentsRoutes);
// File upload endpoints (must come before static /uploads to avoid intercepting multipart requests)
app.use('/api/uploads', uploadRoutes);
app.use('/api/pages', pageRoutes);
app.use('/api/forms', formRoutes);
app.use('/api/flash-sales', flashSaleRoutes);
app.use('/api/bundle-offers', bundleOfferRoutes);
app.use('/api/translate', translateRoutes);
// Generic product Attributes CRUD (admin-protected)
app.use('/api/attributes', attributeRoutes);
// POS System Routes (admin-protected)
app.use('/api/pos', posRoutes);
app.use('/api/rivhit', rivhitRoutes);
app.use('/api/mcg', mcgRoutes);
app.use('/api/zcredit', zcreditRoutes);
app.use('/api/zcredit-gw', zcreditGatewayRoutes);
app.use('/api/cancellation-requests', cancellationRequestRoutes);
app.use('/api/grooming', groomingRoutes);
app.use('/api/search-logs', searchRoutes);
app.use('/', googleFeedRoutes);
app.use('/', metaFeedRoutes);

// Health Check Route
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root route for uptime checks and basic service liveness
app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'mypet-api', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
  try {
    const origin = req.headers.origin;
    if (origin) {
      if (!res.getHeader('Access-Control-Allow-Origin')) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      }
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      const vary = res.getHeader('Vary');
      if (!vary) res.setHeader('Vary', 'Origin');
      else if (!String(vary).includes('Origin')) res.setHeader('Vary', vary + ', Origin');
    } else if (!res.getHeader('Access-Control-Allow-Origin')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
  } catch {}
  res.status(404).json({ message: 'Route not found' });
});

const PORT = process.env.PORT || 8080;

// Create HTTP server
const server = createServer(app);

// WebSocket setup (explicit upgrade handling for stability behind proxies)
// We handle upgrades only for /ws (primary) and /api/ws (fallback when proxied)
// Disable perMessageDeflate to reduce chances of proxy interference closing connection early.
const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

// Extra upgrade diagnostics + explicit routing
server.on('upgrade', (req, socket, head) => {
  try {
    const url = req.url || '/';
    const host = req.headers.host;
    const origin = req.headers.origin;
    const ua = req.headers['user-agent'];
    const secVersion = req.headers['sec-websocket-version'];
    const secProtocol = req.headers['sec-websocket-protocol'];
    console.log('[WS][upgrade] incoming', { url, host, origin, ua, secVersion, secProtocol });

    // Parse path and accept only known endpoints
    let pathname = '/';
    try { pathname = new URL(url, 'http://placeholder').pathname; } catch {}
    const allowed = pathname === '/ws' || pathname === '/api/ws';

    if (!allowed) {
      // Not a ws endpoint we serve – let other listeners (if any) handle or gracefully refuse
      console.warn('[WS][upgrade] rejecting unknown path', pathname);
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    // If client requested a subprotocol, echo first value when establishing (optional)
    const protocols = (secProtocol || '').split(',').map(s => s.trim()).filter(Boolean);

    wss.handleUpgrade(req, socket, head, (ws, request) => {
      // Node ws automatically negotiates permessage-deflate per config; set protocol explicitly
      if (protocols.length && typeof ws.emit === 'function') {
        try { ws.protocol = protocols[0]; } catch {}
      }
      wss.emit('connection', ws, request);
    });
  } catch (e) {
    try { socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n'); } catch {}
    try { socket.destroy(); } catch {}
    console.error('[WS][upgrade] fatal error', e?.message || e);
  }
});

// Track clients (WebSocket) and Server-Sent Events (SSE)
const clients = new Set();
const sseClients = new Set(); // each item: { id, res }

function initSocket(ws, request) {
  const pathInfo = request?.url || 'unknown';
  console.log(`[WS] Connection established path=${pathInfo} total=${clients.size + 1}`);
  clients.add(ws);
  try {
    ws.send(JSON.stringify({
      type: 'connection_established',
      data: { message: 'Connected to real-time updates', path: pathInfo },
      timestamp: new Date().toISOString()
    }));
  } catch {}

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
      } else {
        console.log('[WS] Unknown message type:', data.type);
      }
    } catch (err) {
      console.error('[WS] Error parsing message', err?.message || err);
    }
  });

  ws.on('close', (code, reason) => {
    clients.delete(ws);
    console.log(`[WS] Closed code=${code} reason=${reason?.toString() || ''} remaining=${clients.size}`);
  });

  ws.on('error', (err) => {
    console.error('[WS] Socket error', err?.message || err);
    clients.delete(ws);
  });
}

wss.on('connection', (ws, req) => initSocket(ws, req));

// Function to broadcast to all connected clients (WS + SSE)
export function broadcastToClients(data) {
  const message = JSON.stringify({
    ...data,
    timestamp: new Date().toISOString()
  });
  
  clients.forEach(client => {
    if (client.readyState === client.OPEN) {
      try {
        client.send(message);
      } catch (error) {
        console.error('Error sending message to client:', error);
        clients.delete(client);
      }
    }
  });

  // SSE broadcast (send as event stream line)
  const ssePayload = `data: ${message}\n\n`;
  sseClients.forEach(client => {
    try {
      client.res.write(ssePayload);
    } catch (err) {
      console.error('[SSE] Failed write, removing client', err?.message || err);
      sseClients.delete(client);
    }
  });
}

// Make broadcaster accessible to routes/controllers without creating import cycles
// Routes can access it via req.app.get('broadcastToClients')
app.set('broadcastToClients', broadcastToClients);

// SSE endpoint for settings / real-time updates fallback
app.get('/api/settings/stream', (req, res) => {
  // Setup headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders && res.flushHeaders();

  const id = Date.now() + ':' + Math.random().toString(36).slice(2);
  const clientRef = { id, res };
  sseClients.add(clientRef);
  console.log(`[SSE] Client connected id=${id} total=${sseClients.size}`);

  // Heartbeat every 25s (avoid some proxies timing out)
  const heartbeat = setInterval(() => {
    try { res.write(`: ping ${Date.now()}\n`); } catch {}
  }, 25000);

  // Initial hello
  try {
    res.write(`event: connection\n`);
    res.write(`data: ${JSON.stringify({ type: 'sse_connected', id, ts: new Date().toISOString() })}\n\n`);
  } catch {}

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(clientRef);
    console.log(`[SSE] Client disconnected id=${id} remaining=${sseClients.size}`);
  });
});

// Realtime status endpoint (diagnostics)
app.get('/api/realtime/status', (req, res) => {
  try {
    const mem = process.memoryUsage();
    res.json({
      wsClients: clients.size,
      sseClients: sseClients.size,
      uptimeSec: Math.round(process.uptime()),
      version: APP_VERSION,
      rssMB: +(mem.rss / 1024 / 1024).toFixed(1),
      heapUsedMB: +(mem.heapUsed / 1024 / 1024).toFixed(1)
    });
  } catch (e) {
    res.status(500).json({ message: 'status_error', error: (e?.message || 'unknown') });
  }
});

// Test broadcast route (development aid) - can be disabled behind env guard if needed
app.post('/api/realtime/test-broadcast', (req, res) => {
  try {
    broadcastToClients({
      type: 'settings_updated',
      data: {
        test: true,
        primaryColor: '#'+Math.random().toString(16).slice(2,8).padEnd(6,'0'),
        timestamp: Date.now()
      }
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || 'broadcast_failed' });
  }
});

// Initialize server
const startServer = async () => {
  if (process.env.SKIP_DB === '1') {
    console.warn('Starting server with SKIP_DB=1 (database connection skipped).');
    server.listen(PORT, () => {
      console.log(`Server running (no DB) on port ${PORT}`);
      console.log(`WebSocket server running on ws://localhost:${PORT}/ws`);
    });
    return;
  }

  // Use dbManager for connection with retry
  let conn = null;
  try {
    conn = await dbManager.connectWithRetry();
  } catch (e) {
    console.error('Database connection failed after retries:', e.message);
  }
  if (!conn) {
    console.error('Database connection failed; server not started. Set SKIP_DB=1 to bypass during development.');
    return;
  }

  // Ensure Inventory indexes are in sync (drops outdated indexes and creates new ones)
  try {
    const Inventory = (await import('./models/Inventory.js')).default;
    // This will create indexes defined in the schema and drop any not present
    const syncRes = await Inventory.syncIndexes();
    console.log('[startup][indexes] Inventory.syncIndexes() done:', syncRes);
    // As a safety net, explicitly drop legacy index if it still exists (from pre-variant era)
    try {
      const idxList = await mongoose.connection.db.collection('inventories').indexes();
      const legacyIdx = idxList.find(i => i.name === 'product_1_size_1_color_1');
      if (legacyIdx) {
        await mongoose.connection.db.collection('inventories').dropIndex('product_1_size_1_color_1');
        console.warn('[startup][indexes] Dropped legacy index product_1_size_1_color_1');
      }
    } catch (dropErr) {
      // Non-fatal; continue
      console.warn('[startup][indexes] Legacy index drop check failed:', dropErr?.message || dropErr);
    }
  } catch (idxErr) {
    console.warn('[startup][indexes] Inventory index sync skipped/failed:', idxErr?.message || idxErr);
  }

  try {
    const PaymentSessionModel = (await import('./models/PaymentSession.js')).default;
    await PaymentSessionModel.syncIndexes();
    console.log('[startup][indexes] PaymentSession.syncIndexes() done');
  } catch (psErr) {
    console.warn('[startup][indexes] PaymentSession index sync skipped/failed:', psErr?.message || psErr);
  }

  // Initialize default data after database connection is established
  try {
    // Import and run data initialization
    const User = (await import('./models/User.js')).default;
    const Settings = (await import('./models/Settings.js')).default;
    const FooterSettings = (await import('./models/FooterSettings.js')).default;
    const Background = (await import('./models/Background.js')).default;
  const Form = (await import('./models/Form.js')).default;

    // Create default admin user
    await User.createDefaultAdmin();

    // Create default settings
    await Settings.createDefaultSettings();

    // Create default footer settings
    await FooterSettings.createDefaultSettings();

    // Create default background
    await Background.createDefaultBackground();

  // Create default forms (if none)
  try { await Form.createDefaultForms(); } catch {}

    // Ensure a test delivery company exists
    try {
      const { createTestDeliveryCompany } = await import('./utils/createTestData.js');
      await createTestDeliveryCompany();
    } catch (e) {
      console.warn('Delivery company seeding skipped:', e.message);
    }
    
    

    console.log('✅ Default data initialization completed');
  } catch (error) {
    console.error('❌ Error during data initialization:', error.message);
  }

  // Start real-time services after everything is initialized
  import('./services/realTimeEventService.js');

  // Warm DeepSeek translation config from DB (if configured)
  try {
    await loadDeepseekConfigFromDb();
    console.log('[startup] DeepSeek translation config loaded');
  } catch (e) {
    console.warn('[startup] DeepSeek config load skipped:', e?.message || e);
  }

  try {
    startPaymentSessionJanitor();
    console.log('[startup] Payment session janitor started');
  } catch (e) {
    console.warn('[startup] Payment session janitor start failed:', e?.message || e);
  }

  try {
    startRetentionCleanup();
    console.log('[startup] Retention cleanup started');
  } catch (e) {
    console.warn('[startup] Retention cleanup start failed:', e?.message || e);
  }

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`WebSocket server running on ws://localhost:${PORT}/ws`);
  });
  try { startPushScheduler(app); console.log('[startup] Push scheduler started'); } catch {}
  try { startMcgSyncScheduler(); console.log('[startup] MCG auto-pull scheduler started'); } catch {}
};

// Start server
startServer();

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Promise Rejection:', err);
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
});
