const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const BASE_URL = process.env.BASE_URL || 'http://localhost:5678';
const CATEGORIES = ['Бот', 'Интеграция', 'Отчёт', 'Другое'];

let token = null;
let draftId = null;
let createdTicketId = null;

async function api(path, { method = 'GET', body, tkn = token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (tkn) headers.Authorization = `Bearer ${tkn}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, json };
}

describe('Tickets API', () => {
  before(async () => {
    const login = `ticket_tester_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const reg = await api('/registration', { method: 'POST', tkn: null, body: { login, password: 'password123' } });
    assert.strictEqual(reg.status, 201, 'registration must succeed before ticket tests');
    draftId = reg.json.draft.id;

    const auth = await api('/auth', { method: 'POST', tkn: null, body: { login, password: 'password123' } });
    assert.strictEqual(auth.status, 200);
    token = auth.json.accessToken;
  });

  test('create without draftId returns 400 VALIDATION_ERROR', async () => {
    const { status, json } = await api('/tickets', { method: 'POST', body: { title: 'T', description: 'D', category: 'Бот' } });
    assert.strictEqual(status, 400);
    assert.strictEqual(json.error.code, 'VALIDATION_ERROR');
  });

  test('create without title returns 400', async () => {
    const { status, json } = await api('/tickets', { method: 'POST', body: { draftId, description: 'D', category: 'Бот' } });
    assert.strictEqual(status, 400);
    assert.strictEqual(json.error.code, 'VALIDATION_ERROR');
    assert.match(json.error.message, /Title/);
  });

  test('create without description returns 400', async () => {
    const { status, json } = await api('/tickets', { method: 'POST', body: { draftId, title: 'T', category: 'Бот' } });
    assert.strictEqual(status, 400);
    assert.match(json.error.message, /Description/);
  });

  test('create with invalid category returns 400', async () => {
    const { status, json } = await api('/tickets', { method: 'POST', body: { draftId, title: 'T', description: 'D', category: 'Космос' } });
    assert.strictEqual(status, 400);
    assert.match(json.error.message, /Category/);
  });

  test('create with unknown draftId returns 404 DRAFT_NOT_FOUND', async () => {
    const { status, json } = await api('/tickets', { method: 'POST', body: { draftId: crypto.randomUUID(), title: 'T', description: 'D', category: 'Бот' } });
    assert.strictEqual(status, 404);
    assert.strictEqual(json.error.code, 'DRAFT_NOT_FOUND');
  });

  test('create with another user draft returns 403 TICKET_FORBIDDEN', async () => {
    const login = `other_${Date.now()}`;
    await api('/registration', { method: 'POST', tkn: null, body: { login, password: 'password123' } });
    const otherAuth = await api('/auth', { method: 'POST', tkn: null, body: { login, password: 'password123' } });
    const otherDraft = otherAuth.json.user.draft.id;

    const { status, json } = await api('/tickets', { method: 'POST', body: { draftId: otherDraft, title: 'Hack', description: 'D', category: 'Бот' } });
    assert.strictEqual(status, 403);
    assert.strictEqual(json.error.code, 'TICKET_FORBIDDEN');
  });

  test('successful create: status/created_at are set automatically, same uuid, new draft issued', async () => {
    const { status, json } = await api('/tickets', {
      method: 'POST',
      body: { draftId, title: 'Мой первый бот', description: 'Нужен телеграм-бот', category: 'Бот' },
    });
    assert.strictEqual(status, 201);
    assert.strictEqual(json.ticket.id, draftId, 'ticket must reuse the draft uuid');
    assert.strictEqual(json.ticket.status, 'new', 'status "new" is set automatically');
    assert.ok(json.ticket.created_at, 'created_at is set automatically');
    assert.ok(json.newDraft && json.newDraft.status === 'draft', 'a fresh draft uuid must be issued');
    assert.notStrictEqual(json.newDraft.id, draftId);
    createdTicketId = json.ticket.id;
    draftId = json.newDraft.id; // UI must switch to the new draft
  });

  test('second create with the SAME draftId returns 409 DRAFT_ALREADY_USED (no duplicates)', async () => {
    const { status, json } = await api('/tickets', {
      method: 'POST',
      body: { draftId: createdTicketId, title: 'Дубль', description: 'D', category: 'Бот' },
    });
    assert.strictEqual(status, 409);
    assert.strictEqual(json.error.code, 'DRAFT_ALREADY_USED');
  });

  test('list returns own tickets and hides drafts', async () => {
    const { status, json } = await api('/tickets');
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(json));
    assert.ok(json.some(t => t.id === createdTicketId), 'created ticket must be in the list');
    assert.ok(json.every(t => t.status !== 'draft'), 'drafts must never appear in the list');
  });

  test('list does not return other users tickets', async () => {
    const login = `stranger_${Date.now()}`;
    const otherAuth = await api('/auth', { method: 'POST', tkn: null, body: { login, password: 'password123' } }).catch(() => null);
    // register stranger properly
    await api('/registration', { method: 'POST', tkn: null, body: { login, password: 'password123' } });
    const auth = await api('/auth', { method: 'POST', tkn: null, body: { login, password: 'password123' } });
    assert.strictEqual(auth.status, 200);

    const { json } = await api('/tickets', { tkn: auth.json.accessToken });
    assert.deepStrictEqual(json, [], 'stranger must see an empty list');
  });

  test('search by title substring works', async () => {
    const { status, json } = await api('/tickets?search=первый');
    assert.strictEqual(status, 200);
    assert.strictEqual(json.length, 1);
    assert.strictEqual(json[0].id, createdTicketId);

    const empty = await api('/tickets?search=zzz_ничего_не_найдёт');
    assert.strictEqual(empty.json.length, 0);
  });

  test('filter by status works', async () => {
    const news = await api('/tickets?status=new');
    assert.ok(news.json.some(t => t.id === createdTicketId));

    const done = await api('/tickets?status=done');
    assert.strictEqual(done.json.length, 0);

    const bad = await api('/tickets?status=draft');
    assert.strictEqual(bad.status, 400, 'draft must not be a valid list filter');
  });

  test('edit open ticket (title/description/category)', async () => {
    const { status, json } = await api(`/tickets/${createdTicketId}`, {
      method: 'PATCH',
      body: { title: 'Обновлённый бот', description: 'Новое описание', category: 'Интеграция' },
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(json.title, 'Обновлённый бот');
    assert.strictEqual(json.category, 'Интеграция');
    assert.ok(json.updated_at);
  });

  test('edit with invalid category returns 400', async () => {
    const { status, json } = await api(`/tickets/${createdTicketId}`, { method: 'PATCH', body: { category: 'Еда' } });
    assert.strictEqual(status, 400);
    assert.strictEqual(json.error.code, 'VALIDATION_ERROR');
  });

  test('closed ticket cannot be edited', async () => {
    const close = await api(`/tickets/${createdTicketId}`, { method: 'PATCH', body: { status: 'done' } });
    assert.strictEqual(close.status, 200);
    assert.strictEqual(close.json.status, 'done');

    const { status, json } = await api(`/tickets/${createdTicketId}`, { method: 'PATCH', body: { title: 'Не выйдет' } });
    assert.strictEqual(status, 409);
    assert.strictEqual(json.error.code, 'TICKET_NOT_EDITABLE');
  });

  test('another user cannot read/edit/delete my ticket', async () => {
    const login = `enemy_${Date.now()}`;
    await api('/registration', { method: 'POST', tkn: null, body: { login, password: 'password123' } });
    const auth = await api('/auth', { method: 'POST', tkn: null, body: { login, password: 'password123' } });

    const read = await api(`/tickets/${createdTicketId}`, { tkn: auth.json.accessToken });
    assert.strictEqual(read.status, 403);

    const del = await api(`/tickets/${createdTicketId}`, { method: 'DELETE', tkn: auth.json.accessToken });
    assert.strictEqual(del.status, 403);
  });

  test('delete ticket, then get returns 404', async () => {
    const del = await api(`/tickets/${createdTicketId}`, { method: 'DELETE' });
    assert.strictEqual(del.status, 200);

    const get = await api(`/tickets/${createdTicketId}`);
    assert.strictEqual(get.status, 404);
    assert.strictEqual(get.json.error.code, 'TICKET_NOT_FOUND');
  });

  test('all routes require auth', async () => {
    const { status, json } = await api('/tickets', { tkn: null });
    assert.strictEqual(status, 401);
    assert.strictEqual(json.error.code, 'AUTH_TOKEN_MISSING');
  });
});