import webpush from 'web-push';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../');
const envPath = path.join(root, '.env');

const keys = webpush.generateVAPIDKeys();

let env = '';
try { env = fs.readFileSync(envPath, 'utf8'); } catch {}

function setEnvVar(content, key, value){
  const line = `${key}=${value}`;
  const has = new RegExp(`^${key}=`, 'm').test(content);
  return has ? content.replace(new RegExp(`^${key}=.*`, 'm'), line) : (content.trimEnd() + `\n${line}\n`);
}

let next = env || '';
next = setEnvVar(next, 'VAPID_PUBLIC_KEY', keys.publicKey);
next = setEnvVar(next, 'VAPID_PRIVATE_KEY', keys.privateKey);
next = setEnvVar(next, 'VAPID_SUBJECT', 'mailto:ebrahimzahalka123@gmail.com');

fs.writeFileSync(envPath, next, 'utf8');

console.log('VAPID keys written to .env');
