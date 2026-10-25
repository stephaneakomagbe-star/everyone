'use strict';

const state = {
  me: null,
  home: null,
  detail: null,
  view: 'boot',
  authMode: 'register',
  openStreakId: '',
  captureStreakId: '',
  returnView: 'home',
  facing: 'user',
  captureMode: 'photo',
  stream: null,
  recorder: null,
  recTimer: 0,
  blob: null,
  blobKind: 'image',
  previewUrl: '',
  sending: false,
  effect: 'none',
  collageUrl: '',
};

const WEIGHT = { waiting_you: 0, open: 1, new: 2, solo: 3, cold: 4, waiting_partner: 5, lit: 6 };

const EFFECTS = [
  { id: 'none', label: 'Normal', filter: 'none' },
  { id: 'chaud', label: 'Chaud', filter: 'sepia(0.28) saturate(1.4) contrast(1.05)' },
  { id: 'froid', label: 'Froid', filter: 'saturate(0.75) hue-rotate(18deg) brightness(1.06) contrast(1.04)' },
  { id: 'noir', label: 'Noir', filter: 'grayscale(1) contrast(1.15)' },
  { id: 'vintage', label: 'Vintage', filter: 'sepia(0.4) contrast(0.92) brightness(1.06) saturate(0.85)' },
  { id: 'vif', label: 'Vif', filter: 'saturate(1.7) contrast(1.12)' },
  { id: 'doux', label: 'Doux', filter: 'contrast(0.88) brightness(1.1) saturate(0.92)' },
  { id: 'fade', label: 'Fade', filter: 'contrast(0.82) brightness(1.12) saturate(0.7) sepia(0.12)' },
];

const byId = (id) => document.getElementById(id);

function getTheme() {
  try { return localStorage.getItem('flamme-theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
}

function applyTheme(theme) {
  const dark = theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const color = document.querySelector('meta[name="theme-color"]');
  if (color) color.setAttribute('content', dark ? '#121212' : '#f4f4f4');
  try { localStorage.setItem('flamme-theme', theme); } catch { /* ignore */ }
}

applyTheme(getTheme());

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function addDays(day, amount) {
  const [year, month, date] = day.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, date));
  utc.setUTCDate(utc.getUTCDate() + amount);
  const pad = (n) => String(n).padStart(2, '0');
  return `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}`;
}

function dateLabel(ymd) {
  const [year, month, date] = ymd.split('-').map(Number);
  const formatted = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(year, month - 1, date));
  return formatted.charAt(0).toLocaleUpperCase('fr') + formatted.slice(1);
}

function humanDay(day, today) {
  if (day === addDays(today, -1)) return 'Hier';
  return dateLabel(day);
}

function greeting(name) {
  const hour = new Date().getHours();
  const word = hour < 5 ? 'Bonne nuit' : hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';
  return `${word}, ${name}`;
}

function initial(name) {
  return Array.from(name || '?')[0].toLocaleUpperCase('fr');
}

function formatCode(code) {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

function setHtml(el, html) {
  if (!el || el._html === html) return;
  el._html = html;
  el.innerHTML = html;
}

let toastTimer = 0;
function toast(message) {
  const el = byId('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3400);
}

async function api(path, { method = 'GET', json, form } = {}) {
  const options = { method, credentials: 'same-origin' };
  if (json !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(json);
  }
  if (form) options.body = form;
  let res;
  try {
    res = await fetch(path, options);
  } catch {
    const error = new Error('Le serveur ne répond pas.');
    error.status = 0;
    throw error;
  }
  const text = await res.text();
  let data = {};
  if (text) {
    try { data = JSON.parse(text); } catch { data = { error: 'Réponse illisible.' }; }
  }
  if (!res.ok) {
    const error = new Error(data.error || 'Erreur.');
    error.status = res.status;
    throw error;
  }
  return data;
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function playBoot() {
  const boot = byId('view-boot');
  boot.classList.remove('is-booting');
  void boot.offsetWidth;
  boot.classList.add('is-booting');
}

async function showLogoThen(name) {
  show('boot');
  playBoot();
  await pause(1300);
  show(name);
}

function show(name) {
  state.view = name;
  document.querySelectorAll('.view').forEach((view) => {
    const on = view.id === `view-${name}`;
    view.hidden = !on;
    if (on) {
      const scroller = view.querySelector('.scroll') || view;
      scroller.scrollTop = 0;
    }
  });
  document.body.dataset.view = name;
  document.title = 'Everyone';
}

function faceMarkup(photoId, name) {
  if (photoId) {
    return `<span class="face"><img src="/api/media/${photoId}" alt="Photo de ${esc(name)}"></span>`;
  }
  return `<span class="face">${esc(initial(name))}</span>`;
}

function statusCopy(streak) {
  const many = streak.memberCount > 2;
  const name = esc(streak.partner?.name || 'les autres');
  switch (streak.status) {
    case 'solo':
      return 'Envoie le code. À partir de deux personnes, jusqu’à 12.';
    case 'lit':
      return many ? 'Tout le monde a déposé aujourd’hui. À demain.' : 'Vous avez tenu aujourd’hui. À demain.';
    case 'waiting_partner':
      return many ? 'Ta photo est là. On attend les autres.' : `Ta photo est là. On attend celle de ${name}.`;
    case 'waiting_you':
      return many ? 'Des photos sont arrivées. À toi.' : `La photo de ${name} est arrivée. À toi.`;
    case 'open':
      return 'La série tient encore. Dépose ta photo ou ta vidéo avant minuit.';
    case 'new':
      return 'Première journée. Chacun dépose, et la série commence.';
    case 'cold':
      return streak.best > 0
        ? `La série s’est arrêtée. Record : ${streak.best} ${streak.best > 1 ? 'jours' : 'jour'}. Tout le monde dépose aujourd’hui, et elle repart.`
        : 'La série s’est arrêtée. Tout le monde dépose aujourd’hui, et elle repart.';
    default:
      return '';
  }
}

function subline(streak) {
  const you = streak.youPosted ? 'Toi ✓' : 'Toi · à faire';
  if (streak.memberCount < 2) return `${you} · code à partager`;
  if (streak.memberCount > 2) {
    return `${you} · ${streak.postedCount || 0} sur ${streak.memberCount}`;
  }
  const other = esc(streak.partner?.name || 'L’autre');
  const them = streak.partnerPosted ? `${other} ✓` : `${other} · à faire`;
  return `${you} · ${them}`;
}

function countBlock(streak) {
  if (streak.status === 'cold') return '<p class="count count-word">Arrêtée</p><p class="count-unit">la série</p>';
  if (streak.count <= 0) return '<p class="count">0</p><p class="count-unit">pour l’instant</p>';
  const unit = streak.count > 1 ? 'jours d’affilée' : 'jour d’affilée';
  return `<p class="count">${streak.count}</p><p class="count-unit">${unit}</p>`;
}

function polaroid(drop, name, lazy) {
  const frame = drop
    ? (() => {
      const kind = drop.kind === 'video' ? 'video' : 'image';
      const media = kind === 'video'
        ? `<video src="/api/media/${drop.id}" muted preload="metadata" playsinline></video><span class="play" aria-hidden="true">▶</span>`
        : `<img src="/api/media/${drop.id}" alt="Photo de ${esc(name)}"${lazy ? ' loading="lazy"' : ''} draggable="false">`;
      return `<div class="frame shot" data-action="open-media" data-id="${drop.id}" data-kind="${kind}" data-caption="${esc(drop.caption)}" role="button" tabindex="0" aria-label="Voir le dépôt de ${esc(name)}">${media}</div>`;
    })()
    : '<div class="frame is-empty"><span>En attente</span></div>';
  return `<figure class="polaroid">${frame}<figcaption>${esc(name)}</figcaption></figure>`;
}

function renderHome() {
  const home = state.home;
  if (!home) return;
  byId('home-hello').textContent = greeting(home.me.name);
  const profile = byId('btn-profile');
  profile.classList.toggle('has-photo', Boolean(home.me.photo));
  profile.innerHTML = home.me.photo
    ? `<img src="/api/media/${home.me.photo}" alt="">`
    : esc(initial(home.me.name));
  profile.setAttribute('aria-label', `Profil de ${home.me.name}`);

  const prompt = home.prompt;
  const paired = home.streaks.filter((streak) => streak.memberCount >= 2);
  const pending = paired.filter((streak) => !streak.youPosted).length;
  let extra = '';
  if (pending === 1) extra = '<p class="task-state">Un groupe t’attend.</p>';
  else if (pending > 1) extra = `<p class="task-state">${pending} groupes t’attendent.</p>`;
  else if (paired.length) extra = '<p class="task-state">Tes photos du jour sont déposées.</p>';
  setHtml(byId('task-card'), `
    <article class="task-card">
      <p class="eyebrow">Tâche du jour</p>
      <h2>${esc(prompt.title)}</h2>
      <p>${esc(prompt.hint)}</p>
      <p class="time">Avant minuit</p>
      ${extra}
    </article>
  `);

  const streaks = [...home.streaks].sort((a, b) => (WEIGHT[a.status] ?? 9) - (WEIGHT[b.status] ?? 9));
  const list = streaks.length
    ? streaks.map(cardHtml).join('')
    : `<div class="empty-state"><p class="empty-title">Pas encore de groupe</p><p class="hint">Crée un groupe et envoie le code. Chaque jour, chacun dépose une photo ou une vidéo.</p></div>`;
  setHtml(byId('streak-list'), list);
}

function cardHtml(streak) {
  const count = streak.status === 'cold'
    ? 'Éteinte'
    : streak.count > 0
      ? `${streak.count} ${streak.count > 1 ? 'jours' : 'jour'}`
      : 'Pas encore';
  const cta = streak.youPosted
    ? ''
    : `<button class="btn btn-primary" type="button" data-action="start-drop" data-id="${streak.id}">${streak.status === 'cold' ? 'Reprendre' : 'Déposer ma photo'}</button>`;
  return `
    <article class="card">
      <div class="card-hit" data-action="open-streak" data-id="${streak.id}" role="link" tabindex="0" aria-label="Ouvrir le groupe de ${esc(streak.label)}">
        <div class="card-flame">${faceMarkup(streak.partner ? streak.partnerPhoto : streak.youPhoto, streak.label)}</div>
        <div>
          <p class="card-count">${esc(count)}</p>
          <h2>${esc(streak.label)}</h2>
          <p class="card-sub">${subline(streak)}</p>
        </div>
      </div>
      ${cta}
    </article>
  `;
}

function monthLabel(ym) {
  const [year, month] = ym.split('-').map(Number);
  const formatted = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
  return formatted.charAt(0).toLocaleUpperCase('fr') + formatted.slice(1);
}

function monthItems(streak) {
  const rows = [];
  for (const day of streak.history) {
    const drops = day.drops || [day.you, day.partner].filter(Boolean);
    for (const drop of drops) {
      if (drop?.id) rows.push({ day: day.day, ...drop, name: drop.name || 'Toi' });
    }
  }
  const todayMembers = streak.members || [];
  if (todayMembers.length) {
    for (const member of todayMembers) {
      if (member.drop?.id) rows.push({ day: streak.today, ...member.drop, name: member.name });
    }
  } else {
    if (streak.youDrop) rows.push({ day: streak.today, ...streak.youDrop, name: 'Toi' });
    if (streak.partnerDrop) rows.push({ day: streak.today, ...streak.partnerDrop, name: streak.label });
  }
  const byMonth = new Map();
  for (const row of rows) {
    const key = String(row.day).slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(row);
  }
  return [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function collageBlock(streak) {
  const months = monthItems(streak);
  if (!months.length) return '';
  return `<p class="eyebrow block-title">Chaque mois</p>${months.map(([month, items]) => {
    const photos = items.filter((item) => item.kind !== 'video').length;
    const videos = items.length - photos;
    const bits = [];
    if (photos) bits.push(`${photos} photo${photos > 1 ? 's' : ''}`);
    if (videos) bits.push(`${videos} vidéo${videos > 1 ? 's' : ''}`);
    return `<div class="collage-row">
      <div><h3>${esc(monthLabel(month))}</h3><p class="hint">${esc(bits.join(' · '))}</p></div>
      <div class="collage-actions">
        <button class="btn btn-ghost" type="button" data-action="collage" data-month="${month}" data-mode="photo">Photo</button>
        <button class="btn btn-ghost" type="button" data-action="collage" data-month="${month}" data-mode="video">Vidéo</button>
      </div>
    </div>`;
  }).join('')}`;
}

function gridFor(count) {
  if (count <= 1) return { cols: 1, rows: 1 };
  if (count === 2) return { cols: 2, rows: 1 };
  if (count <= 4) return { cols: 2, rows: 2 };
  if (count <= 6) return { cols: 3, rows: 2 };
  return { cols: 3, rows: 3 };
}

function drawCover(ctx, source, dx, dy, dw, dh) {
  const sw = source.videoWidth || source.naturalWidth || source.width;
  const sh = source.videoHeight || source.naturalHeight || source.height;
  if (!sw || !sh) return;
  const scale = Math.max(dw / sw, dh / sh);
  const w = sw * scale;
  const h = sh * scale;
  ctx.drawImage(source, dx + (dw - w) / 2, dy + (dh - h) / 2, w, h);
}

function loadStill(item) {
  const url = `/api/media/${item.id}`;
  if (item.kind === 'video') {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.src = url;
      video.onerror = () => resolve(null);
      video.onloadeddata = () => {
        const at = Number.isFinite(video.duration) ? Math.min(0.4, video.duration / 2) : 0;
        if (at > 0) {
          video.onseeked = () => resolve(video);
          video.currentTime = at;
        } else resolve(video);
      };
    });
  }
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

async function loadFrames(items) {
  const frames = [];
  for (const item of items.slice(0, 9)) {
    const source = await loadStill(item);
    if (source) frames.push(source);
  }
  return frames;
}

async function paintCollage(items, month) {
  const frames = await loadFrames(items);
  if (!frames.length) throw new Error('Rien à coller pour ce mois.');
  const canvas = document.createElement('canvas');
  const size = 1080;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1c1c1c';
  ctx.fillRect(0, 0, size, size);
  const { cols, rows } = gridFor(frames.length);
  const gap = 14;
  const head = 78;
  const cellW = (size - gap * (cols + 1)) / cols;
  const cellH = (size - head - gap * (rows + 1)) / rows;
  ctx.fillStyle = '#fff';
  ctx.font = '600 40px Segoe UI, sans-serif';
  ctx.fillText(monthLabel(month), gap, 52);
  frames.forEach((source, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = gap + col * (cellW + gap);
    const y = head + gap + row * (cellH + gap);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, cellW, cellH);
    ctx.clip();
    ctx.fillStyle = '#333';
    ctx.fillRect(x, y, cellW, cellH);
    drawCover(ctx, source, x, y, cellW, cellH);
    ctx.restore();
  });
  return canvas;
}

async function collageVideo(items, month) {
  const mime = pickMime();
  if (!mime) throw new Error('Le collage vidéo n’est pas disponible ici.');
  const frames = await loadFrames(items);
  if (!frames.length) throw new Error('Rien à coller pour ce mois.');
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 960;
  const ctx = canvas.getContext('2d');
  const stream = canvas.captureStream(12);
  const recorder = new MediaRecorder(stream, { mimeType: mime });
  const chunks = [];
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
  const draw = (source) => {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawCover(ctx, source, 0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, canvas.height - 76, canvas.width, 76);
    ctx.fillStyle = '#fff';
    ctx.font = '600 28px Segoe UI, sans-serif';
    ctx.fillText(monthLabel(month), 24, canvas.height - 30);
  };
  draw(frames[0]);
  recorder.start(100);
  for (const source of frames) {
    draw(source);
    await pause(1100);
  }
  recorder.stop();
  await stopped;
  stream.getTracks().forEach((track) => track.stop());
  return new Blob(chunks, { type: recorder.mimeType || mime });
}

async function openCollage(month, mode) {
  const found = monthItems(state.detail || { history: [] }).find(([key]) => key === month);
  const items = found ? found[1] : [];
  toast(mode === 'video' ? 'Collage vidéo…' : 'Collage…');
  try {
    if (state.collageUrl) URL.revokeObjectURL(state.collageUrl);
    state.collageUrl = '';
    if (mode === 'video') {
      const blob = await collageVideo(items, month);
      state.collageUrl = URL.createObjectURL(blob);
      byId('light-media').innerHTML = `<video src="${state.collageUrl}" controls autoplay playsinline></video>`;
    } else {
      const canvas = await paintCollage(items, month);
      const image = new Image();
      image.alt = monthLabel(month);
      image.src = canvas.toDataURL('image/jpeg', 0.9);
      byId('light-media').innerHTML = '';
      byId('light-media').appendChild(image);
    }
    byId('light-caption').textContent = monthLabel(month);
    byId('lightbox').hidden = false;
  } catch (error) {
    toast(error.message || 'Collage impossible.');
  }
}

function renderStreak() {
  const streak = state.detail;
  if (!streak) return;
  document.title = `${streak.label} · Everyone`;
  byId('streak-heading').textContent = streak.label;
  const partnerName = streak.label;
  const prompt = streak.prompt;
  const dots = streak.dots.map((dot) => (
    `<li class="dot ${dot.state}" title="${esc(dot.label)}"><span class="sr">${esc(dot.label)}</span></li>`
  )).join('');
  const history = streak.history.length
    ? `<p class="eyebrow block-title">Avant</p>${streak.history.map((day) => `
        <article class="memory">
          <header>
            <h3>${esc(humanDay(day.day, streak.today))}</h3>
            <span class="badge ${day.complete ? 'ok' : 'no'}">${day.complete ? 'Tenue' : 'Incomplète'}</span>
          </header>
          <div class="pair mini">
            ${(day.drops || []).map((drop) => polaroid(drop.id ? drop : null, drop.name, true)).join('')}
          </div>
        </article>
      `).join('')}`
    : '<p class="hint end-note">Le premier souvenir s’ajoute demain, si la série tient.</p>';
  const record = streak.best > streak.count && streak.best > 0
    ? `<p class="hint">Record : ${streak.best} ${streak.best > 1 ? 'jours' : 'jour'}</p>`
    : '';

  setHtml(byId('streak-scroll'), `
    <div class="hero ${streak.status}">
      <div class="faces">
        ${(streak.members || []).slice(0, 8).map((member) => faceMarkup(member.photo, member.name)).join('')}
      </div>
      ${countBlock(streak)}
      <button class="code-chip" type="button" data-action="copy" data-copy="${esc(streak.code)}" aria-label="Copier le code">${esc(formatCode(streak.code))}</button>
      <p class="status">${statusCopy(streak)}</p>
      ${record}
    </div>
    <div class="pair today">
      ${(streak.members || [{ name: 'Toi', drop: streak.youDrop }, { name: partnerName, drop: streak.partnerDrop }])
        .map((member) => polaroid(member.drop, member.name))
        .join('')}
    </div>
    <article class="task-card">
      <p class="eyebrow">Tâche du jour</p>
      <h2>${esc(prompt.title)}</h2>
      <p>${esc(prompt.hint)}</p>
      <p class="time" id="streak-time"></p>
    </article>
    ${collageBlock(streak)}
    <p class="eyebrow block-title">Les jours</p>
    <ol class="dots">${dots}</ol>
    <p class="legend"><span class="key lit"></span> tout le monde <span class="key half"></span> en partie <span class="key missed"></span> manqué</p>
    ${history}
  `);
  const time = byId('streak-time');
  if (time) time.textContent = 'Avant minuit';
  const label = streak.youPosted ? 'Changer ma photo' : 'Déposer ma photo';
  const klass = streak.youPosted ? 'btn btn-ghost' : 'btn btn-primary';
  setHtml(byId('streak-dock'), `<button class="${klass}" type="button" data-action="start-drop" data-id="${streak.id}">${label}</button>`);
}

async function refreshHome(noisy) {
  try {
    state.home = await api('/api/home');
    state.me = state.home.me;
    if (state.view === 'home') renderHome();
  } catch (error) {
    if (error.status === 401) {
      state.me = null;
      show('auth');
      return;
    }
    if (noisy) toast(error.message);
  }
}

async function refreshDetail(noisy) {
  if (!state.openStreakId) return;
  try {
    state.detail = await api(`/api/streaks/${state.openStreakId}`);
    if (state.view === 'streak') renderStreak();
  } catch (error) {
    if (error.status === 401) {
      state.me = null;
      show('auth');
      return;
    }
    if (noisy) toast(error.message);
  }
}

async function openStreak(id) {
  state.openStreakId = id;
  show('streak');
  const body = byId('streak-scroll');
  body._html = '';
  body.innerHTML = '<p class="muted">Chargement…</p>';
  const dock = byId('streak-dock');
  dock._html = '';
  dock.innerHTML = '';
  byId('streak-heading').textContent = '';
  await refreshDetail(true);
}

function openSheet(html) {
  byId('sheet-body').innerHTML = html;
  byId('overlay').hidden = false;
}

function closeSheet() {
  byId('overlay').hidden = true;
  byId('sheet-body').innerHTML = '';
}

function setAuthMode(mode) {
  state.authMode = mode;
  const register = mode === 'register';
  byId('auth-submit').textContent = register ? 'Créer mon espace' : 'Entrer';
  byId('auth-switch').textContent = register ? 'J’ai déjà un compte' : 'Créer un compte';
  byId('password-hint').hidden = !register;
  byId('auth-title').textContent = register ? 'Créer un compte' : 'Connexion';
  byId('password').autocomplete = register ? 'new-password' : 'current-password';
}

async function onAuth(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const button = byId('auth-submit');
  button.disabled = true;
  try {
    state.me = await api(state.authMode === 'register' ? '/api/register' : '/api/login', {
      method: 'POST',
      json: { name: form.get('name'), password: form.get('password') },
    });
    await refreshHome(true);
    await showLogoThen('home');
    renderHome();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
}

async function onCreate(event) {
  event.preventDefault();
  const title = new FormData(event.target).get('title');
  const button = event.target.querySelector('button');
  button.disabled = true;
  try {
    const data = await api('/api/streaks', { method: 'POST', json: { title } });
    await refreshHome(false);
    renderInvite(data);
  } catch (error) {
    toast(error.message);
    button.disabled = false;
  }
}

function renderInvite(data) {
  const streak = data.streak;
  const urls = (data.addresses || []).map((ip) => `http://${ip}:${data.port}`);
  byId('sheet-body').innerHTML = `
    <p class="eyebrow">Code</p>
    <h2 id="sheet-title">Envoie-le.</h2>
    <p class="lede">Chacun ouvre Everyone, crée son espace, puis entre ce code. Jusqu’à 12 personnes.</p>
    <button class="code-display" type="button" data-action="copy" data-copy="${esc(streak.code)}">${esc(formatCode(streak.code))}</button>
    <p class="hint">Appuie pour copier.</p>
    ${urls.length ? `<div class="urls">${urls.map((url) => `<button type="button" class="url" data-action="copy" data-copy="${esc(url)}">${esc(url)}</button>`).join('')}</div><p class="hint">Même Wi-Fi : cette adresse, puis le code.</p>` : `<p class="hint">Sur cet ordinateur : http://localhost:${data.port}</p>`}
    <button class="btn btn-primary" type="button" data-action="open-streak" data-id="${streak.id}">Voir le groupe</button>
  `;
}

async function onJoin(event) {
  event.preventDefault();
  const raw = String(new FormData(event.target).get('code') || '');
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 6) {
    toast('Le code fait 6 caractères.');
    return;
  }
  try {
    const data = await api('/api/streaks/join', { method: 'POST', json: { code } });
    closeSheet();
    await refreshHome(false);
    toast(`Everyone avec ${data.streak.label}.`);
    openStreak(data.streak.id);
  } catch (error) {
    toast(error.message);
  }
}

function openNew() {
  openSheet(`
    <p class="eyebrow">Groupe</p>
    <h2 id="sheet-title">Nouveau groupe</h2>
    <p class="lede">Un nom pour vous. Tu recevras un code à envoyer. Deux personnes, ou un groupe jusqu’à 12.</p>
    <form id="form-new">
      <label>Nom
        <input name="title" maxlength="24" required placeholder="Les amis" autocomplete="off">
      </label>
      <button class="btn btn-primary" type="submit">Créer le code</button>
    </form>
  `);
  byId('sheet-body').querySelector('input')?.focus();
}

function openJoin() {
  openSheet(`
    <p class="eyebrow">Invitation</p>
    <h2 id="sheet-title">Entrer un code</h2>
    <form id="form-join">
      <label>Code
        <input name="code" required maxlength="12" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="AB3 K9Q">
      </label>
      <button class="btn btn-primary" type="submit">Rejoindre</button>
    </form>
  `);
  byId('sheet-body').querySelector('input')?.focus();
}

function openProfile() {
  openSheet(`
    <p class="eyebrow">Toi</p>
    <h2 id="sheet-title">${esc(state.me.name)}</h2>
    <ol class="steps">
      <li>Crée un groupe et envoie le code.</li>
      <li>Les autres créent leur espace et entrent le code.</li>
      <li>Chaque jour, avant minuit, chacun dépose une photo ou une courte vidéo.</li>
    </ol>
    <p class="hint">Dépose seulement ce que tu as envie de montrer. Les photos restent sur l’ordinateur qui fait tourner Everyone.</p>
    <button class="btn btn-ghost" type="button" data-action="toggle-theme">${getTheme() === 'dark' ? 'Mode clair' : 'Mode sombre'}</button>
    <button class="btn btn-ghost" type="button" data-action="logout">Se déconnecter</button>
  `);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copié.');
  } catch {
    toast('Copie impossible. Note-le à l’écran.');
  }
}

async function logout() {
  try { await api('/api/logout', { method: 'POST' }); } catch { /* on sort quand même */ }
  state.me = null;
  state.home = null;
  state.detail = null;
  closeSheet();
  setAuthMode('login');
  show('auth');
}

function stopStream() {
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
}

function revokePreview() {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = '';
  state.blob = null;
}

function stopRecording(silent) {
  clearInterval(state.recTimer);
  const badge = byId('rec-time');
  if (badge) badge.hidden = true;
  byId('shutter')?.classList.remove('recording');
  if (state.recorder && state.recorder.state === 'recording') {
    if (silent) state.recorder.onstop = null;
    state.recorder.stop();
  }
  state.recorder = null;
}

function setMode(mode) {
  state.captureMode = mode;
  byId('mode-photo').setAttribute('aria-pressed', String(mode === 'photo'));
  byId('mode-video').setAttribute('aria-pressed', String(mode === 'video'));
  byId('shutter').setAttribute('aria-label', mode === 'video' ? 'Enregistrer une vidéo' : 'Prendre la photo');
  updateMirror();
}

function updateMirror() {
  byId('cam').classList.toggle('mirror', state.captureMode === 'photo' && state.facing === 'user');
}

function setLiveAvailable(ok) {
  byId('shutter').hidden = !ok;
  byId('flip-cam').hidden = !ok;
  byId('mode-switch').hidden = !ok;
  byId('device-actions').hidden = ok;
}

async function startCamera() {
  stopStream();
  const errorEl = byId('cam-error');
  errorEl.hidden = true;
  if (!navigator.mediaDevices?.getUserMedia) {
    setLiveAvailable(false);
    errorEl.hidden = false;
    errorEl.textContent = 'La caméra de la page n’est pas disponible ici. Les boutons ouvrent l’appareil du téléphone.';
    return;
  }
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: state.facing, width: { ideal: 1280 }, height: { ideal: 1600 } },
    });
    const video = byId('cam');
    video.srcObject = state.stream;
    updateMirror();
    await video.play();
    setLiveAvailable(true);
  } catch {
    setLiveAvailable(false);
    errorEl.hidden = false;
    errorEl.textContent = 'La caméra de la page est bloquée. Utilise Prendre une photo : ça ouvre l’appareil du téléphone.';
  }
}

function openCapture(id, returnView) {
  state.captureStreakId = id;
  state.returnView = returnView;
  state.openStreakId = id;
  setMode('photo');
  revokePreview();
  byId('cam-review').hidden = true;
  byId('cam-live').hidden = false;
  byId('replace-note').hidden = true;
  const prompt = state.detail?.prompt?.title || state.home?.prompt?.title || 'Aujourd’hui';
  byId('cam-prompt').textContent = prompt;
  show('capture');
  startCamera();
}

function closeCapture() {
  stopRecording(true);
  stopStream();
  revokePreview();
  byId('cam').srcObject = null;
  byId('cam-review').hidden = true;
  byId('cam-live').hidden = false;
  const back = state.returnView || 'home';
  show(back);
  if (back === 'streak') refreshDetail(false);
  else refreshHome(false);
}

function currentStreakPosted() {
  const fromHome = state.home?.streaks?.find((streak) => streak.id === state.captureStreakId);
  if (fromHome) return fromHome.youPosted;
  if (state.detail?.id === state.captureStreakId) return state.detail.youPosted;
  return false;
}

function showReview(blob, kind) {
  stopRecording(true);
  stopStream();
  revokePreview();
  state.blob = blob;
  state.blobKind = kind;
  state.previewUrl = URL.createObjectURL(blob);
  const image = byId('preview');
  const video = byId('preview-video');
  if (kind === 'video') {
    image.hidden = true;
    video.hidden = false;
    video.src = state.previewUrl;
  } else {
    video.hidden = true;
    video.removeAttribute('src');
    image.hidden = false;
    image.src = state.previewUrl;
  }
  byId('cam-live').hidden = true;
  byId('cam-review').hidden = false;
  byId('caption').value = '';
  byId('replace-note').hidden = !currentStreakPosted();
  state.effect = 'none';
  image.style.filter = 'none';
  const filters = byId('filters');
  filters.hidden = kind !== 'image';
  renderEffectButtons();
}

function retake() {
  revokePreview();
  byId('preview-video').removeAttribute('src');
  byId('cam-review').hidden = true;
  byId('cam-live').hidden = false;
  startCamera();
}

function snapPhoto() {
  const video = byId('cam');
  if (!video.videoWidth) {
    toast('La caméra n’est pas prête.');
    return;
  }
  const max = 1600;
  const scale = Math.min(1, max / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.round(video.videoWidth * scale);
  const height = Math.round(video.videoHeight * scale);
  const canvas = byId('snap');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (state.facing === 'user') {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, width, height);
  canvas.toBlob((blob) => {
    if (!blob) {
      toast('La photo n’a pas pu être créée.');
      return;
    }
    showReview(blob, 'image');
  }, 'image/jpeg', 0.86);
}

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function toggleRecord() {
  if (state.recorder && state.recorder.state === 'recording') {
    state.recorder.stop();
    return;
  }
  if (!state.stream || typeof MediaRecorder === 'undefined') {
    toast('L’enregistrement n’est pas disponible. Filme avec le bouton du téléphone, ou dépose une photo.');
    return;
  }
  const mime = pickMime();
  let recorder;
  try {
    recorder = new MediaRecorder(state.stream, mime ? { mimeType: mime } : undefined);
  } catch {
    toast('Impossible d’enregistrer ici. Choisis une vidéo dans la galerie.');
    return;
  }
  const chunks = [];
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  recorder.onstop = () => {
    clearInterval(state.recTimer);
    byId('rec-time').hidden = true;
    byId('shutter').classList.remove('recording');
    const type = recorder.mimeType || mime || 'video/webm';
    const blob = new Blob(chunks, { type });
    state.recorder = null;
    if (blob.size < 100) {
      toast('Vidéo vide.');
      return;
    }
    showReview(blob, 'video');
  };
  state.recorder = recorder;
  recorder.start();
  byId('shutter').classList.add('recording');
  const started = Date.now();
  const badge = byId('rec-time');
  badge.hidden = false;
  badge.textContent = '0:00';
  state.recTimer = setInterval(() => {
    const seconds = Math.min(10, Math.round((Date.now() - started) / 1000));
    badge.textContent = `0:${String(seconds).padStart(2, '0')}`;
    if (Date.now() - started >= 10000 && recorder.state === 'recording') recorder.stop();
  }, 200);
}

async function compressImage(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await createImageBitmap(file);
  }
  const max = 1600;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
  if (!blob) throw new Error('Impossible de lire cette image.');
  return blob;
}

async function onPickedFile(file) {
  if (!file) return;
  if (file.type.startsWith('video/')) {
    if (file.size > 25 * 1024 * 1024) throw new Error('Vidéo trop lourde (25 Mo maximum). Filme moins longtemps.');
    showReview(file, 'video');
    return;
  }
  showReview(await compressImage(file), 'image');
}

function renderEffectButtons() {
  const box = byId('filters');
  if (!box) return;
  box.innerHTML = EFFECTS.map((effect) => (
    `<button type="button" data-action="effect" data-effect="${effect.id}" aria-pressed="${state.effect === effect.id ? 'true' : 'false'}">${effect.label}</button>`
  )).join('');
}

async function bakeEffect(blob, effectId) {
  const spec = EFFECTS.find((effect) => effect.id === effectId);
  if (!spec || spec.filter === 'none') return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = byId('snap');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.filter = spec.filter;
  ctx.drawImage(bitmap, 0, 0);
  ctx.filter = 'none';
  bitmap.close?.();
  const out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  return out || blob;
}

async function sendDrop() {
  if (!state.blob || state.sending) return;
  state.sending = true;
  const button = byId('btn-send');
  button.disabled = true;
  button.textContent = 'Envoi…';
  try {
    let blob = state.blob;
    if (state.blobKind === 'image' && state.effect !== 'none') blob = await bakeEffect(blob, state.effect);
    const form = new FormData();
    const type = blob.type || '';
    const filename = type.includes('mp4') ? 'video.mp4' : type.startsWith('video/') ? 'video.webm' : 'photo.jpg';
    form.append('media', blob, filename);
    form.append('caption', byId('caption').value);
    await api(`/api/streaks/${state.captureStreakId}/drops`, { method: 'POST', form });
    toast('C’est déposé.');
    revokePreview();
    byId('preview-video').removeAttribute('src');
    byId('cam-review').hidden = true;
    byId('cam-live').hidden = false;
    state.openStreakId = state.captureStreakId;
    show('streak');
    await refreshDetail(true);
    refreshHome(false);
  } catch (error) {
    toast(error.message);
  } finally {
    state.sending = false;
    button.disabled = false;
    button.textContent = 'Déposer';
  }
}

function openMedia(id, kind, caption) {
  if (!/^[a-f0-9]{16}$/.test(id)) return;
  const safeKind = kind === 'video' ? 'video' : 'image';
  byId('light-media').innerHTML = safeKind === 'video'
    ? `<video src="/api/media/${id}" controls autoplay playsinline></video>`
    : `<img src="/api/media/${id}" alt="">`;
  byId('light-caption').textContent = caption || '';
  byId('lightbox').hidden = false;
}

function closeLight() {
  byId('lightbox').hidden = true;
  byId('light-media').innerHTML = '';
  byId('light-caption').textContent = '';
  if (state.collageUrl) URL.revokeObjectURL(state.collageUrl);
  state.collageUrl = '';
}

function bindPickers() {
  for (const id of ['camera-input', 'camera-back', 'video-input', 'file-input']) {
    byId(id).addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      try {
        await onPickedFile(file);
      } catch (error) {
        toast(error.message || 'Impossible de lire ce fichier.');
      }
    });
  }
}

byId('app').addEventListener('click', (event) => {
  if (event.target.id === 'overlay') {
    closeSheet();
    return;
  }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'auth-switch') setAuthMode(state.authMode === 'register' ? 'login' : 'register');
  else if (action === 'show-new') openNew();
  else if (action === 'show-join') openJoin();
  else if (action === 'show-profile') openProfile();
  else if (action === 'close-sheet') closeSheet();
  else if (action === 'logout') logout();
  else if (action === 'copy') copyText(button.dataset.copy || '');
  else if (action === 'open-streak') {
    const id = button.dataset.id;
    closeSheet();
    openStreak(id);
  } else if (action === 'back-home') {
    show('home');
    refreshHome(false);
  } else if (action === 'start-drop') {
    openCapture(button.dataset.id || state.openStreakId, state.view === 'home' ? 'home' : 'streak');
  } else if (action === 'close-capture') closeCapture();
  else if (action === 'flip-camera') {
    state.facing = state.facing === 'user' ? 'environment' : 'user';
    startCamera();
  } else if (action === 'mode-photo') setMode('photo');
  else if (action === 'mode-video') setMode('video');
  else if (action === 'shutter') {
    if (state.captureMode === 'video') toggleRecord();
    else snapPhoto();
  } else if (action === 'retake') retake();
  else if (action === 'send-drop') sendDrop();
  else if (action === 'open-media') openMedia(button.dataset.id, button.dataset.kind, button.dataset.caption || '');
  else if (action === 'collage') openCollage(button.dataset.month, button.dataset.mode);
  else if (action === 'effect') {
    state.effect = button.dataset.effect || 'none';
    const spec = EFFECTS.find((effect) => effect.id === state.effect) || EFFECTS[0];
    byId('preview').style.filter = spec.filter;
    renderEffectButtons();
  }
  else if (action === 'close-light') closeLight();
  else if (action === 'toggle-theme') {
    applyTheme(getTheme() === 'dark' ? 'light' : 'dark');
    openProfile();
  }
});

byId('app').addEventListener('submit', (event) => {
  if (event.target.id === 'form-auth') onAuth(event);
  else if (event.target.id === 'form-new') onCreate(event);
  else if (event.target.id === 'form-join') onJoin(event);
});

byId('app').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  if (event.target.closest('input, textarea')) return;
  const button = event.target.closest('[data-action]');
  if (!button || button.tagName === 'BUTTON' || button.tagName === 'A' || button.tagName === 'LABEL') return;
  event.preventDefault();
  button.click();
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!byId('lightbox').hidden) closeLight();
  else if (state.view === 'capture') closeCapture();
  else if (!byId('overlay').hidden) closeSheet();
});

async function boot() {
  bindPickers();
  playBoot();
  const splash = pause(1300);
  try {
    state.me = await api('/api/me');
    await refreshHome(false);
    await splash;
    show('home');
    renderHome();
  } catch (error) {
    await splash;
    setAuthMode('register');
    show('auth');
    if (error.status !== 401) toast(error.message);
  }
  setInterval(() => {
    if (document.hidden || !state.me) return;
    if (!byId('overlay').hidden || !byId('lightbox').hidden) return;
    if (state.view === 'home') refreshHome(false);
    if (state.view === 'streak') refreshDetail(false);
  }, 12000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !state.me) return;
    if (state.view === 'home') refreshHome(false);
    if (state.view === 'streak') refreshDetail(false);
  });
}

boot();
