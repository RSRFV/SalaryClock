/**
 * 时薪时钟 SalaryClock 后端（零第三方依赖）
 * - 注册 / 登录（scrypt 加盐哈希，HMAC token）
 * - 单用户快照同步：GET /api/sync、PUT /api/sync
 * - 同时托管前端静态文件，部署时只需一个 Node 进程
 *
 * 运行：node server/index.mjs   （默认 127.0.0.1:8788）
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');
const PORT = Number(process.env.PORT || 8788);
const HOST = process.env.HOST || '127.0.0.1';
const TOKEN_TTL = 30 * 24 * 3600 * 1000;

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(SECRET_FILE)) {
  fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
}
const SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();

function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return { users: {} };
  }
}
function saveUsers(db) {
  const tmp = `${USERS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, USERS_FILE);
}
const db = loadUsers();

const b64u = (s) => Buffer.from(s).toString('base64url');

function signToken(username) {
  const payload = b64u(JSON.stringify({ u: username, exp: Date.now() + TOKEN_TTL }));
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expect = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!p.u || !p.exp || p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

const hashPassword = (password, salt) => crypto.scryptSync(password, salt, 64).toString('hex');

function validUsername(name) {
  return typeof name === 'string' && /^[a-zA-Z0-9_.-]{3,24}$/.test(name);
}
function validPassword(pw) {
  return typeof pw === 'string' && pw.length >= 6 && pw.length <= 128;
}

function json(res, status, body, extra = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
    ...extra,
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 4 * 1024 * 1024) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  if (rel.includes('..') || rel.startsWith('.')) return false;
  if (/^(server|data|mobile|android-native|dist|tests|\.git)(\/|$)/.test(rel)) return false;
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) return false;
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'content-type': mime,
    'cache-control': 'no-cache',
    'access-control-allow-origin': '*',
  });
  fs.createReadStream(file).pipe(res);
  return true;
}

const attempts = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const rec = attempts.get(ip) || { count: 0, reset: now + 60000 };
  if (now > rec.reset) {
    rec.count = 0;
    rec.reset = now + 60000;
  }
  rec.count += 1;
  attempts.set(ip, rec);
  return rec.count > 20;
}

function authUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const payload = verifyToken(token);
  return payload ? payload.u : null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const ip = req.socket.remoteAddress || 'unknown';

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, authorization',
      'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
      'access-control-max-age': '86400',
    });
    return res.end();
  }

  if (!pathname.startsWith('/api/')) {
    if (serveStatic(res, pathname)) return;
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }

  try {
    if (pathname === '/api/health') {
      return json(res, 200, { ok: true, time: Date.now(), users: Object.keys(db.users).length });
    }

    if (pathname === '/api/auth/register' && req.method === 'POST') {
      if (rateLimited(ip)) return json(res, 429, { error: '请求过于频繁，请稍后再试' });
      const body = await readBody(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      if (!validUsername(username)) return json(res, 400, { error: '用户名需 3–24 位字母、数字、下划线、点或短横线' });
      if (!validPassword(password)) return json(res, 400, { error: '密码至少 6 位' });
      if (db.users[username.toLowerCase()]) return json(res, 409, { error: '用户名已存在' });
      const salt = crypto.randomBytes(16).toString('hex');
      db.users[username.toLowerCase()] = {
        username,
        salt,
        hash: hashPassword(password, salt),
        createdAt: Date.now(),
        updatedAt: 0,
        data: null,
      };
      saveUsers(db);
      return json(res, 201, { token: signToken(username.toLowerCase()), user: { username } });
    }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      if (rateLimited(ip)) return json(res, 429, { error: '请求过于频繁，请稍后再试' });
      const body = await readBody(req);
      const username = String(body.username || '').trim().toLowerCase();
      const password = String(body.password || '');
      const user = db.users[username];
      if (!user || hashPassword(password, user.salt) !== user.hash) {
        return json(res, 401, { error: '用户名或密码错误' });
      }
      return json(res, 200, { token: signToken(username), user: { username: user.username } });
    }

    if (pathname === '/api/sync' && req.method === 'GET') {
      const username = authUser(req);
      if (!username) return json(res, 401, { error: '未登录或登录已过期' });
      const user = db.users[username];
      if (!user) return json(res, 401, { error: '用户不存在' });
      return json(res, 200, { data: user.data || null, updatedAt: user.updatedAt || 0 });
    }

    if (pathname === '/api/sync' && req.method === 'PUT') {
      const username = authUser(req);
      if (!username) return json(res, 401, { error: '未登录或登录已过期' });
      const body = await readBody(req);
      if (!body.data || typeof body.data !== 'object') return json(res, 400, { error: '缺少 data' });
      const user = db.users[username];
      if (!user) return json(res, 401, { error: '用户不存在' });
      user.data = body.data;
      user.updatedAt = Number(body.updatedAt) || Date.now();
      saveUsers(db);
      return json(res, 200, { ok: true, updatedAt: user.updatedAt });
    }

    return json(res, 404, { error: 'not found' });
  } catch (err) {
    return json(res, 400, { error: err.message || 'bad request' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`SalaryClock server → http://${HOST}:${PORT}`);
  console.log(`数据目录：${DATA_DIR}`);
});
