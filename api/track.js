// api/track.js
const { Client } = require('pg');

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  return new Client({
    connectionString,
    ssl: { rejectUnauthorized: false } // Supabase 需要 SSL
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    let body = req.body;

    // Vercel 某些环境下 req.body 可能是字符串，做一下兼容
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) {}
    }

    const { code, channel, wave, eventType, cost, metadata } = body || {};

    if (!code || typeof code !== 'string') {
      res.statusCode = 400;
      res.json({ error: 'code is required' });
      return;
    }
    if (!channel || typeof channel !== 'string') {
      res.statusCode = 400;
      res.json({ error: 'channel is required' });
      return;
    }
    if (!['issued', 'claimed', 'activated'].includes(eventType)) {
      res.statusCode = 400;
      res.json({ error: 'eventType must be issued|claimed|activated' });
      return;
    }

    const client = createClient();
    await client.connect();

    const insertText = `
      INSERT INTO invitation_events (code, channel, wave, event_type, cost, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, created_at
    `;

    const result = await client.query(insertText, [
      code.trim(),
      channel.trim(),
      wave || null,
      eventType,
      cost != null ? Number(cost) : null,
      metadata ? JSON.stringify(metadata) : null,
    ]);

    await client.end();

    res.statusCode = 200;
    res.json({
      success: true,
      id: result.rows[0].id,
      createdAt: result.rows[0].created_at,
    });
  } catch (err) {
    console.error('track error', err);
    res.statusCode = 500;
    res.json({ error: 'Internal Server Error' });
  }
};
