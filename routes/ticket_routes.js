const express = require('express');
const ticketService = require('../services/ticket_service');
const { requireAuth } = require('../middleware/auth_middleware');

const router = express.Router();

// All ticket routes require a valid access token.
router.use(requireAuth);

// GET /tickets?search=<text>&status=<status> -> own tickets (drafts hidden)
router.get('/', async (req, res, next) => {
  try {
    const tickets = await ticketService.listTickets(req.user.id, {
      search: req.query.search,
      status: req.query.status,
    });
    res.json(tickets);
  } catch (err) {
    next(err);
  }
});

// POST /tickets { draftId, title, description, category } -> 201 { ticket, newDraft }
router.post('/', async (req, res, next) => {
  try {
    const { draftId, title, description, category } = req.body || {};
    const result = await ticketService.createFromDraft(req.user.id, { draftId, title, description, category });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// GET /tickets/:id -> own ticket
router.get('/:id', async (req, res, next) => {
  try {
    res.json(await ticketService.getTicket(req.user.id, req.params.id));
  } catch (err) {
    next(err);
  }
});

// PATCH /tickets/:id { title?, description?, category?, status? } -> updated ticket
router.patch('/:id', async (req, res, next) => {
  try {
    res.json(await ticketService.updateTicket(req.user.id, req.params.id, req.body || {}));
  } catch (err) {
    next(err);
  }
});

// DELETE /tickets/:id -> { message, id }
router.delete('/:id', async (req, res, next) => {
  try {
    res.json(await ticketService.deleteTicket(req.user.id, req.params.id));
  } catch (err) {
    next(err);
  }
});

module.exports = router;