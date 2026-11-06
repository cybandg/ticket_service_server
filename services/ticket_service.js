const db = require('./supabase_service');
const { ApiError } = require('../middleware/error_handler');

const CATEGORIES = ['Бот', 'Интеграция', 'Отчёт', 'Другое'];
const STATUSES = ['draft', 'new', 'in_work', 'done', 'closed'];
// Tickets in these statuses can be edited/deleted ("open" tickets).
const EDITABLE_STATUSES = ['draft', 'new', 'in_work'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value, fieldName) {
  if (!value || !UUID_RE.test(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${fieldName} must be a valid UUID`);
  }
}

// Creates an empty draft ticket for a user (one per user, enforced by DB index).
async function createDraft(userId) {
  return db.insert('tickets', { user_id: userId, status: 'draft' });
}

// Returns user's current draft (or null).
async function getUserDraft(userId) {
  return db.selectOne('tickets', `user_id=eq.${userId}&status=eq.draft&limit=1`);
}

// GET /tickets?search=...&status=... — only own tickets, drafts are hidden.
async function listTickets(userId, { search, status } = {}) {
  const params = [`user_id=eq.${userId}`, 'status=neq.draft', 'order=created_at.desc'];

  if (status) {
    if (!STATUSES.includes(status) || status === 'draft') {
      throw new ApiError(400, 'VALIDATION_ERROR', `Status must be one of: ${STATUSES.filter(s => s !== 'draft').join(', ')}`);
    }
    params.push(`status=eq.${encodeURIComponent(status)}`);
  }
  if (search) {
    // ilike = case-insensitive LIKE; * is the PostgREST wildcard
    params.push(`title=ilike.*${encodeURIComponent(search.trim().replace(/[*]/g, ''))}*`);
  }
  return db.select('tickets', params.join('&'));
}

// GET /tickets/:id — only own ticket.
async function getTicket(userId, ticketId) {
  assertUuid(ticketId, 'ticketId');
  const ticket = await db.selectOne('tickets', `id=eq.${ticketId}`);
  if (!ticket) throw new ApiError(404, 'TICKET_NOT_FOUND', 'Ticket not found');
  if (ticket.user_id !== userId) throw new ApiError(403, 'TICKET_FORBIDDEN', 'You cannot access this ticket');
  return ticket;
}

// POST /tickets — converts the user's draft into a real ticket ("Новая").
// draftId is MANDATORY: it guarantees no duplicated ticket registration.
async function createFromDraft(userId, { draftId, title, description, category }) {
  assertUuid(draftId, 'draftId');

  if (!title || !String(title).trim()) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Title is required');
  }
  if (!description || !String(description).trim()) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Description is required');
  }
  if (!category || !CATEGORIES.includes(category)) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Category is required and must be one of: ${CATEGORIES.join(', ')}`);
  }

  const now = new Date().toISOString();

  // Conditional update: only a row that is STILL a draft and belongs to this user
  // can be converted. Protects against double-submit / race conditions.
  const updated = await db.update(
    'tickets',
    `id=eq.${draftId}&user_id=eq.${userId}&status=eq.draft`,
    {
      title: String(title).trim(),
      description: String(description).trim(),
      category,
      status: 'new',
      created_at: now,
      updated_at: now,
    }
  );

  if (updated.length === 0) {
    const anyTicket = await db.selectOne('tickets', `id=eq.${draftId}`);
    if (!anyTicket) {
      throw new ApiError(404, 'DRAFT_NOT_FOUND', 'Draft not found (wrong draftId?)');
    }
    if (anyTicket.user_id !== userId) {
      throw new ApiError(403, 'TICKET_FORBIDDEN', 'This draft belongs to another user');
    }
    throw new ApiError(409, 'DRAFT_ALREADY_USED', 'This draft was already used to create a ticket, get a fresh draft via /auth/me');
  }

  const ticket = updated[0];

  // On successful save — a brand-new draft UUID is issued for the user.
  const newDraft = await createDraft(userId);

  console.log(`Ticket created from draft: ${ticket.id} (user ${userId}), new draft ${newDraft.id}`);
  return { ticket, newDraft };
}

// PATCH /tickets/:id — edit fields / change status. Only open tickets (or draft).
async function updateTicket(userId, ticketId, patch) {
  const ticket = await getTicket(userId, ticketId);

  if (!EDITABLE_STATUSES.includes(ticket.status)) {
    throw new ApiError(409, 'TICKET_NOT_EDITABLE', `Ticket in status "${ticket.status}" cannot be edited`);
  }

  const body = { updated_at: new Date().toISOString() };

  if (patch.title !== undefined) {
    if (!String(patch.title).trim()) throw new ApiError(400, 'VALIDATION_ERROR', 'Title cannot be empty');
    body.title = String(patch.title).trim();
  }
  if (patch.description !== undefined) {
    if (!String(patch.description).trim()) throw new ApiError(400, 'VALIDATION_ERROR', 'Description cannot be empty');
    body.description = String(patch.description).trim();
  }
  if (patch.category !== undefined) {
    if (!CATEGORIES.includes(patch.category)) {
      throw new ApiError(400, 'VALIDATION_ERROR', `Category must be one of: ${CATEGORIES.join(', ')}`);
    }
    body.category = patch.category;
  }
  if (patch.status !== undefined) {
    if (ticket.status === 'draft') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Draft status cannot be changed directly, submit it as a ticket');
    }
    if (!STATUSES.includes(patch.status) || patch.status === 'draft') {
      throw new ApiError(400, 'VALIDATION_ERROR', `Status must be one of: ${STATUSES.filter(s => s !== 'draft').join(', ')}`);
    }
    body.status = patch.status;
  }

  if (Object.keys(body).length === 1) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Nothing to update: provide title, description, category or status');
  }

  const rows = await db.update('tickets', `id=eq.${ticketId}`, body);
  return rows[0];
}

// DELETE /tickets/:id — only own, non-draft tickets.
async function deleteTicket(userId, ticketId) {
  const ticket = await getTicket(userId, ticketId);
  if (ticket.status === 'draft') {
    throw new ApiError(400, 'DRAFT_NOT_DELETABLE', 'Draft cannot be deleted, it is bound to the user');
  }
  await db.remove('tickets', `id=eq.${ticketId}&user_id=eq.${userId}`);
  console.log(`Ticket deleted: ${ticketId} (user ${userId})`);
  return { message: 'Ticket deleted', id: ticketId };
}

module.exports = {
  CATEGORIES,
  STATUSES,
  createDraft,
  getUserDraft,
  listTickets,
  getTicket,
  createFromDraft,
  updateTicket,
  deleteTicket,
};