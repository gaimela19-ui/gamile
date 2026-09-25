import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';

// Resolve .env path to project/.env (server/index.js loads ../.env from server)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_PATH = path.resolve(__dirname, '../../.env');

// Load env once
dotenv.config({ path: ENV_PATH });

let currentUri = process.env.MONGODB_URI || '';
let status = {
  connected: false,
  host: null,
  error: null,
  lastConnectedAt: null,
};

function maskUri(uri) {
  try {
    if (!uri) return '';
    const url = new URL(uri);
    if (url.username) {
      url.password = url.password ? '****' : '';
    }
    // Hide long db name partially
    if (url.pathname && url.pathname.length > 2) {
      const db = url.pathname.replace('/', '');
      const masked = db.length > 6 ? db.slice(0, 3) + '***' + db.slice(-2) : db;
      url.pathname = '/' + masked;
    }
    return url.toString();
  } catch {
    return '***';
  }
}

export function getConfig() {
  return {
    uriMasked: maskUri(currentUri),
    hasUri: Boolean(currentUri),
  };
}

export function getStatus() {
  const ready = mongoose.connection.readyState; // 0=disconnected 1=connected 2=connecting 3=disconnecting 99=uninitialized
  return {
    ...status,
    readyState: ready,
  };
}

export async function testConnection(uri) {
  const testUri = uri || currentUri;
  if (!testUri) throw new Error('No MongoDB URI provided');
  const conn = await mongoose.createConnection(testUri, {
    maxPoolSize: 2,
    serverSelectionTimeoutMS: 4000,
    socketTimeoutMS: 8000,
  }).asPromise();
  await conn.close();
  return true;
}

export async function connect(uri) {
  const toUse = uri || currentUri;
  if (!toUse) throw new Error('No MongoDB URI configured');
  const conn = await mongoose.connect(toUse, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });
  status.connected = true;
  status.host = conn.connection.host;
  status.error = null;
  status.lastConnectedAt = new Date().toISOString();

  mongoose.connection.on('error', (err) => {
    status.connected = false;
    status.error = err.message;
  });
  mongoose.connection.on('disconnected', () => {
    status.connected = false;
  });
  mongoose.connection.on('reconnected', () => {
    status.connected = true;
    status.error = null;
  });
  return conn;
}

export async function connectWithRetry(maxRetries = 5) {
  let attempt = 0;
  for (;;) {
    try {
      return await connect();
    } catch (err) {
      attempt++;
      status.error = err.message;
      if (attempt > maxRetries) throw err;
      const delay = Math.min(1000 * 2 ** (attempt - 1), 30000);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

export async function applyConfig({ uri }) {
  if (!uri || typeof uri !== 'string') {
    throw new Error('Invalid MongoDB URI');
  }

  // Test first
  await testConnection(uri);

  // Persist to .env
  persistEnvVar('MONGODB_URI', uri);

  // Update in-memory
  currentUri = uri;
  process.env.MONGODB_URI = uri;

  // Reconnect using new URI
  if (mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2) {
    await mongoose.disconnect();
  }
  await connect();

  return { ok: true };
}

export async function reconnect() {
  if (!currentUri) throw new Error('No MongoDB URI configured');
  if (mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2) {
    await mongoose.disconnect();
  }
  await connect();
  return { ok: true };
}

function persistEnvVar(key, value) {
  try {
    // Ensure file exists
    if (!fs.existsSync(ENV_PATH)) {
      fs.writeFileSync(ENV_PATH, `${key}=${value}\n`);
      return;
    }

    const raw = fs.readFileSync(ENV_PATH, 'utf8');
    const lines = raw.split(/\r?\n/);
    let found = false;
    const updated = lines.map((line) => {
      if (line.startsWith(`${key}=`)) {
        found = true;
        return `${key}=${value}`;
      }
      return line;
    });
    if (!found) updated.push(`${key}=${value}`);
    fs.writeFileSync(ENV_PATH, updated.filter(Boolean).join('\n') + '\n', 'utf8');
  } catch (e) {
    // Do not crash server if .env is not writable
    console.warn('Warning: could not persist env var to .env:', e.message);
  }
}

export default {
  getConfig,
  getStatus,
  testConnection,
  connect,
  connectWithRetry,
  applyConfig,
  reconnect,
};
