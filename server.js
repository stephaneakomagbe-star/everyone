'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { dayFromDate, promptFor, addDays } = require('./lib/day');
const { indexDrops, makeComplete, currentStreak, bestStreak, statusOf } = require('./lib/streak');
const { classify } = require('./lib/media');

const PORT = Number(process.env.PORT || 4317);
const GROUP_MAX = 12;
const ROOT = __dirname;
const DATA = process.env.FLAMME_DATA
  ? path.resolve(process.env.FLAMME_DATA)
  : process.env.VERCEL
    ? path.join(os.tmpdir(), 'everyone')
    : path.join(ROOT, 'data');
const MEDIA = path.join(DATA, 'media');
const DB_PATH = path.join(DATA, 'db.json');

fs.mkdirSync(MEDIA, { recursive: true });

function emptyDb() {
  return { users: [], sessions: [], streaks: [], drops: [] };
}

function load() {
  if (!fs.existsSync(DB_PATH)) return emptyDb();
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  db.users ||= [];
  db.sessions ||= [];
  db.streaks ||= [];
  db.drops ||= [];
  return db;
}

function save(db) {
  const tmp = `${DB_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.copyFileSync(tmp, DB_PATH);
  fs.rmSync(tmp, { force: true });
}

if (!fs.existsSync(DB_PATH)) save(emptyDb());

let chain = Promise.resolve();
function mutate(fn) {
  const run = chain.then(() => {
    const db = load();
    const result = fn(db);
    save(db);
    return result;
  });
  chain = run.then(() => undefined, () => undefined);
  return run;
}

function nid() {
  return crypto.randomBytes(8).toString('hex');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const actual = crypto.scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

const DUMMY_HASH = hashPassword('flamme-not-a-real-password');

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function cleanName(value) {
  return String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

function validName(name) {
  return /^[\p{L}][\p{L}\p{M}'’ .-]{1,23}$/u.test(name);
}

function validTitle(name) {
  return /^[\p{L}\p{N}][\p{L}\p{N}\p{M}'’ .-]{1,23}$/u.test(name);
}

function keyName(name) {
  return name.normalize('NFC').toLocaleLowerCase('fr');
}

function cleanCaption(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function cleanCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode() {
  const bytes = crypto.randomBytes(6);
  let code = '';
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

function uniqueCode(db) {
  for (let i = 0; i < 12; i += 1) {
    const code = makeCode();
    if (!db.streaks.some((streak) => streak.code === code)) return code;
  }
  fail(500, 'Impossible de créer un code.');
}

function serverToday() {
  return dayFromDate(new Date());
}

function publicUser(user) {
  return { id: user.id, name: user.name };
}

function brief(drop) {
  if (!drop) return null;
  return {
    id: drop.id,
    kind: drop.mime.startsWith('video/') ? 'video' : 'image',
    caption: drop.caption || '',
  };
}

function latestImageId(byDay, userId) {
  const days = Object.keys(byDay).sort().reverse();
  for (const day of days) {
    const drop = byDay[day]?.[userId];
    if (drop && !drop.mime.startsWith('video/')) return drop.id;
  }
  return null;
}

function latestOwnPhoto(db, userId) {
  return latestImageId(indexDrops(db.drops.filter((drop) => drop.userId === userId)), userId);
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

function setSession(res, token) {
  res.setHeader('Set-Cookie', `flamme=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`);
}

function clearSession(res) {
  res.setHeader('Set-Cookie', 'flamme=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

function newSession(db, userId) {
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions.push({ hash: sha256(token), userId, createdAt: Date.now() });
  const mine = db.sessions.filter((session) => session.userId === userId);
  if (mine.length > 8) {
    const drop = new Set(mine.slice(0, mine.length - 8).map((session) => session.hash));
    db.sessions = db.sessions.filter((session) => !drop.has(session.hash));
  }
  return token;
}

function lanAddresses() {
  const skip = /vmware|virtualbox|hyper-v|vethernet|bluetooth|loopback|pseudo|wsl|docker|npcap|tunnel|tailscale/i;
  const found = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (skip.test(name)) continue;
    for (const net of list || []) {
      const v4 = net.family === 'IPv4' || net.family === 4;
      if (v4 && !net.internal) found.push(net.address);
    }
  }
  const score = (ip) => {
    if (ip.startsWith('192.168.')) return 3;
    if (ip.startsWith('10.')) return 2;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return 2;
    return 1;
  };
  return [...new Set(found)].sort((a, b) => score(b) - score(a));
}

function context(db, streak, userId, today) {
  const drops = db.drops.filter((drop) => drop.streakId === streak.id);
  const byDay = indexDrops(drops);
  const members = streak.memberIds
    .map((id) => db.users.find((user) => user.id === id))
    .filter(Boolean);
  const partner = members.find((user) => user.id !== userId) || null;
  return {
    streak,
    userId,
    today,
    byDay,
    members,
    partner,
    isComplete: makeComplete(byDay, streak.memberIds),
  };
}

function summarize(ctx) {
  const { streak, userId, today, byDay, partner, isComplete } = ctx;
  const count = currentStreak(isComplete, today);
  const best = bestStreak(isComplete, streak.createdDay, today);
  const members = ctx.members || [];
  const youDrop = brief(byDay[today]?.[userId]);
  const partnerDrop = partner ? brief(byDay[today]?.[partner.id]) : null;
  const todayComplete = isComplete(today);
  const people = members.map((member) => ({
    id: member.id,
    name: member.name,
    posted: Boolean(byDay[today]?.[member.id]),
    drop: brief(byDay[today]?.[member.id]),
    photo: latestImageId(byDay, member.id),
  }));
  const youFirst = [
    ...people.filter((member) => member.id === userId),
    ...people.filter((member) => member.id !== userId),
  ];
  const othersPosted = youFirst.filter((member) => member.id !== userId && member.posted).length;
  const label = members.length === 2 && partner ? partner.name : streak.title;
  return {
    id: streak.id,
    code: streak.code,
    title: streak.title,
    createdDay: streak.createdDay,
    createdAt: streak.createdAt,
    label,
    partner: partner ? { id: partner.id, name: partner.name } : null,
    members: youFirst,
    count,
    best,
    status: statusOf({
      memberCount: streak.memberIds.length,
      youPosted: Boolean(youDrop),
      partnerPosted: Boolean(partnerDrop),
      othersPosted,
      count,
      todayComplete,
      createdDay: streak.createdDay,
      today,
    }),
    youPosted: Boolean(youDrop),
    partnerPosted: Boolean(partnerDrop),
    postedCount: youFirst.filter((member) => member.posted).length,
    youDrop,
    partnerDrop,
    youPhoto: latestImageId(byDay, userId),
    partnerPhoto: partner ? latestImageId(byDay, partner.id) : null,
    memberCount: streak.memberIds.length,
  };
}

function describeDay({ day, today, byDay, memberIds }) {
  const need = memberIds.length;
  const posted = memberIds.filter((id) => byDay[day]?.[id]).length;
  const full = need >= 2 && posted === need;
  if (day === today) {
    if (full) return { day, state: 'lit', label: 'Aujourd’hui, tout le monde' };
    if (posted > 0) return { day, state: 'half', label: `Aujourd’hui, ${posted} sur ${need}` };
    return { day, state: 'today', label: 'Aujourd’hui' };
  }
  if (full) return { day, state: 'lit', label: 'Tout le monde' };
  if (posted > 0) return { day, state: 'half', label: `${posted} sur ${need}` };
  return { day, state: 'missed', label: 'Manqué' };
}

function detail(ctx, summary) {
  const { streak, userId, today, byDay, members, isComplete } = ctx;
  const memberIds = streak.memberIds;
  const ordered = [
    ...members.filter((member) => member.id === userId),
    ...members.filter((member) => member.id !== userId),
  ];
  const dots = [];
  for (let i = 13; i >= 0; i -= 1) {
    const day = addDays(today, -i);
    if (day < streak.createdDay) continue;
    dots.push(describeDay({ day, today, byDay, memberIds }));
  }
  const history = Object.keys(byDay)
    .filter((day) => day < today && day >= streak.createdDay)
    .sort()
    .reverse()
    .slice(0, 40)
    .map((day) => ({
      day,
      complete: isComplete(day),
      drops: ordered.map((member) => ({
        name: member.name,
        ...(brief(byDay[day][member.id]) || {}),
      })),
    }));
  return { ...summary, dots, history, prompt: promptFor(today) };
}

function auth(req, res, next) {
  const token = readCookie(req, 'flamme');
  if (!token) return res.status(401).json({ error: 'Connecte-toi.' });
  const db = load();
  const session = db.sessions.find((item) => item.hash === sha256(token));
  const user = session && db.users.find((item) => item.id === session.userId);
  if (!user) return res.status(401).json({ error: 'Session expirée. Reconnecte-toi.' });
  req.user = publicUser(user);
  next();
}

function route(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res)).catch((error) => {
      if (res.headersSent) return next(error);
      const status = error.status || 500;
      if (status >= 500) console.error(error);
      res.status(status).json({
        error: status >= 500 ? 'Une erreur est survenue.' : error.message,
      });
    });
  };
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 26 * 1024 * 1024, files: 1 },
});

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});
app.use(express.json({ limit: '32kb' }));
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.get('/api/me', auth, (req, res) => {
  res.json(req.user);
});

app.post('/api/register', route(async (req, res) => {
  const name = cleanName(req.body?.name);
  const password = String(req.body?.password || '').trim();
  if (!validName(name)) fail(400, 'Choisis un prénom de 2 à 24 lettres.');
  if (password.length < 4 || password.length > 64) fail(400, 'Le code secret doit faire au moins 4 caractères.');
  const created = await mutate((db) => {
    if (db.users.length >= 200) fail(400, 'Cet espace ne peut plus accueillir de compte.');
    if (db.users.some((user) => keyName(user.name) === keyName(name))) {
      fail(409, 'Ce prénom est déjà pris. Entre avec ton code secret, ou choisis-en un autre.');
    }
    const user = {
      id: nid(),
      name,
      passwordHash: hashPassword(password),
      createdAt: Date.now(),
    };
    db.users.push(user);
    return { token: newSession(db, user.id), user: publicUser(user) };
  });
  setSession(res, created.token);
  res.status(201).json(created.user);
}));

app.post('/api/login', route(async (req, res) => {
  const name = cleanName(req.body?.name);
  const password = String(req.body?.password || '').trim();
  if (!name || !password) fail(401, 'Prénom ou code secret incorrect.');
  const created = await mutate((db) => {
    const user = db.users.find((item) => keyName(item.name) === keyName(name));
    const ok = verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);
    if (!user || !ok) fail(401, 'Prénom ou code secret incorrect.');
    return { token: newSession(db, user.id), user: publicUser(user) };
  });
  setSession(res, created.token);
  res.json(created.user);
}));

app.post('/api/logout', route(async (req, res) => {
  const token = readCookie(req, 'flamme');
  if (token) {
    const hash = sha256(token);
    await mutate((db) => {
      db.sessions = db.sessions.filter((session) => session.hash !== hash);
    });
  }
  clearSession(res);
  res.json({ ok: true });
}));

app.get('/api/home', auth, route(async (req, res) => {
  const today = serverToday();
  const db = load();
  const streaks = db.streaks
    .filter((streak) => streak.memberIds.includes(req.user.id))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((streak) => summarize(context(db, streak, req.user.id, today)));
  res.json({
    today,
    prompt: promptFor(today),
    me: { ...req.user, photo: latestOwnPhoto(db, req.user.id) },
    port: PORT,
    addresses: lanAddresses(),
    streaks,
  });
}));

app.post('/api/streaks', auth, route(async (req, res) => {
  const title = cleanName(req.body?.title);
  if (!validTitle(title)) fail(400, 'Indique un nom, entre 2 et 24 caractères.');
  const today = serverToday();
  const streakId = await mutate((db) => {
    const mine = db.streaks.filter((streak) => streak.memberIds.includes(req.user.id)).length;
    if (mine >= 30) fail(400, 'Tu as déjà beaucoup de groupes.');
    const streak = {
      id: nid(),
      code: uniqueCode(db),
      title,
      memberIds: [req.user.id],
      createdDay: today,
      createdAt: Date.now(),
    };
    db.streaks.push(streak);
    return streak.id;
  });
  const db = load();
  const streak = db.streaks.find((item) => item.id === streakId);
  res.status(201).json({
    streak: summarize(context(db, streak, req.user.id, today)),
    port: PORT,
    addresses: lanAddresses(),
  });
}));

app.post('/api/streaks/join', auth, route(async (req, res) => {
  const code = cleanCode(req.body?.code);
  if (code.length !== 6) fail(400, 'Le code fait 6 caractères.');
  const today = serverToday();
  const streakId = await mutate((db) => {
    const streak = db.streaks.find((item) => item.code === code);
    if (!streak) fail(404, 'Ce code ne correspond à aucun groupe.');
    if (streak.memberIds.includes(req.user.id)) fail(400, 'Tu es déjà dans ce groupe.');
    if (streak.memberIds.length >= GROUP_MAX) fail(409, `Ce groupe est plein (${GROUP_MAX} personnes).`);
    const mine = db.streaks.filter((item) => item.memberIds.includes(req.user.id)).length;
    if (mine >= 30) fail(400, 'Tu as déjà beaucoup de groupes.');
    streak.memberIds.push(req.user.id);
    return streak.id;
  });
  const db = load();
  const streak = db.streaks.find((item) => item.id === streakId);
  res.json({ streak: summarize(context(db, streak, req.user.id, today)) });
}));

app.get('/api/streaks/:id', auth, route(async (req, res) => {
  if (!/^[a-f0-9]{16}$/.test(req.params.id)) fail(404, 'Groupe introuvable.');
  const db = load();
  const streak = db.streaks.find((item) => item.id === req.params.id);
  if (!streak || !streak.memberIds.includes(req.user.id)) fail(404, 'Groupe introuvable.');
  const today = serverToday();
  const ctx = context(db, streak, req.user.id, today);
  res.json({ today, ...detail(ctx, summarize(ctx)) });
}));

app.post('/api/streaks/:id/drops', auth, (req, res, next) => {
  upload.single('media')(req, res, (error) => {
    if (!error) return next();
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'Fichier trop lourd (25 Mo maximum).'
      : 'Envoi impossible.';
    res.status(400).json({ error: message });
  });
}, route(async (req, res) => {
  if (!/^[a-f0-9]{16}$/.test(req.params.id)) fail(404, 'Groupe introuvable.');
  if (!req.file) fail(400, 'Choisis une photo ou une vidéo.');
  const classified = classify(req.file.buffer);
  if (!classified) fail(400, 'Format non accepté. Utilise une photo JPEG, PNG, WEBP ou une vidéo MP4, WEBM.');
  if (classified.error) fail(400, classified.error);
  const caption = cleanCaption(req.body?.caption);
  const today = serverToday();
  let obsolete = '';
  await mutate((db) => {
    const streak = db.streaks.find((item) => item.id === req.params.id);
    if (!streak || !streak.memberIds.includes(req.user.id)) fail(404, 'Groupe introuvable.');
    const prev = db.drops.find((drop) => drop.streakId === streak.id && drop.userId === req.user.id && drop.day === today);
    const kept = db.drops.filter((drop) => drop.streakId === streak.id && drop.id !== prev?.id).length;
    if (kept >= 3000) fail(400, 'Trop de souvenirs dans ce groupe.');
    const drop = {
      id: nid(),
      streakId: streak.id,
      userId: req.user.id,
      day: today,
      caption,
      mime: classified.mime,
      ext: classified.ext,
      createdAt: Date.now(),
    };
    fs.writeFileSync(path.join(MEDIA, `${drop.id}${drop.ext}`), req.file.buffer);
    if (prev) {
      obsolete = path.join(MEDIA, `${prev.id}${prev.ext}`);
      db.drops = db.drops.filter((item) => item.id !== prev.id);
    }
    db.drops.push(drop);
  });
  if (obsolete) fs.rmSync(obsolete, { force: true });
  const db = load();
  const streak = db.streaks.find((item) => item.id === req.params.id);
  const ctx = context(db, streak, req.user.id, today);
  res.status(201).json({ streak: detail(ctx, summarize(ctx)) });
}));

app.get('/api/media/:id', auth, (req, res) => {
  if (!/^[a-f0-9]{16}$/.test(req.params.id)) return res.status(404).end();
  const db = load();
  const drop = db.drops.find((item) => item.id === req.params.id);
  if (!drop) return res.status(404).end();
  const streak = db.streaks.find((item) => item.id === drop.streakId);
  if (!streak || !streak.memberIds.includes(req.user.id)) return res.status(404).end();
  const file = path.join(MEDIA, `${drop.id}${drop.ext}`);
  const relative = path.relative(MEDIA, file);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(file)) return res.status(404).end();
  res.setHeader('Content-Type', drop.mime);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(file);
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Introuvable.' });
});

app.use(express.static(path.join(ROOT, 'public')));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Message illisible.' });
  }
  console.error(error);
  res.status(500).json({ error: 'Une erreur est survenue.' });
});

if (require.main === module) {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('  Everyone est lancé.');
    console.log(`  Sur cet ordinateur :  http://localhost:${PORT}`);
    for (const ip of lanAddresses()) {
      console.log(`  Sur le même Wi-Fi :   http://${ip}:${PORT}`);
    }
    console.log('');
  });
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Le port ${PORT} est déjà utilisé. Ferme l’autre Everyone, ou choisis un autre port.`);
    } else {
      console.error(error);
    }
    process.exit(1);
  });
}

module.exports = app;
module.exports.app = app;
