require('dotenv').config({ quiet: true });

const express = require('express');
const supabaseService = require('./services/supabase_service');
const authRoutes = require('./routes/auth_routes');
const ticketRoutes = require('./routes/ticket_routes');
const { notFoundHandler, errorHandler } = require('./middleware/error_handler');

const app = express();
const PORT = process.env.PORT || 5678;

// --- CORS: required for the GitHub Pages frontend.
// "ngrok-skip-browser-warning" must be allowed, otherwise the browser preflight (OPTIONS)
// fails and every request to the ngrok free URL is blocked. ---
const ALLOWED_HEADERS = 'Content-Type, Authorization, ngrok-skip-browser-warning';

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Max-Age', '86400');   // cache preflight for 24h, less OPTIONS traffic
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());

// --- Healthcheck ---
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// --- Routes ---
app.use('/', authRoutes);        // /registration, /auth, /auth/refresh, /auth/me, /logout
app.use('/tickets', ticketRoutes);

// --- 404 + error handler (must be last) ---
app.use(notFoundHandler);
app.use(errorHandler);

// --- Startup: create tables if not exist, then listen ---
(async () => {
  try {
    await supabaseService.ensureSchema();
    app.listen(PORT, () => {
      console.log(`Server started on port ${PORT}`);
      console.log(`CORS allowed headers: ${ALLOWED_HEADERS}`);
    });
  } catch (err) {
    console.error('Failed to initialize database schema:', err.message);
    console.error('Check SUPABASE_URL / SUPABASE_PROJECT_REF / SUPABASE_ACCESS_TOKEN in .env');
    process.exit(1);
  }
})();