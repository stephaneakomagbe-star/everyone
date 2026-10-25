'use strict';

const PROMPTS = [
  { title: 'Selfie du matin', hint: 'Ton visage, tel que la journée te trouve.' },
  { title: 'Ce que tu vois', hint: 'Cadre ce qui est devant toi, sans mise en scène.' },
  { title: 'Le ciel', hint: 'Lève les yeux et dépose le ciel du jour.' },
  { title: 'Un détail', hint: 'Un objet, une lumière, une texture près de toi.' },
  { title: 'Un sourire', hint: 'Même petit. Même de travers.' },
  { title: 'Là où tu es', hint: 'La pièce, la rue, le trajet.' },
  { title: 'Ta main', hint: 'Ce que tu tiens, ou simplement ta main au repos.' },
  { title: 'Une couleur', hint: 'La couleur qui domine ton moment.' },
  { title: 'Ton verre', hint: 'Café, eau, thé : ce qui t’accompagne.' },
  { title: 'Un coin de lumière', hint: 'Là où le jour se pose.' },
];

function pad(n) {
  return String(n).padStart(2, '0');
}

function dayFromDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(day, amount) {
  const [year, month, date] = day.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, date));
  utc.setUTCDate(utc.getUTCDate() + amount);
  return `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}`;
}

function dayIndex(day) {
  const [year, month, date] = day.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, date) / 86400000);
}

function promptFor(day) {
  const index = dayIndex(day);
  const safe = ((index % PROMPTS.length) + PROMPTS.length) % PROMPTS.length;
  return PROMPTS[safe];
}

module.exports = { PROMPTS, dayFromDate, addDays, promptFor };
