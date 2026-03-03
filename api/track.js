// api/track.js
const { Client } = require('pg');

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  return new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });
}

async function insertInvitationEvent(client, payload) {
  const { code, channel, wave, eventType, cost, metadata } = payload;

  if (!code || typeof code !== 'string') {
    throw new Error('code is required for invitation event');
  }
  if (!channel || typeof channel !== 'string') {
    throw new Error('channel is required for invitation event');
  }
  if (!['issued', 'claimed', 'activated'].includes(eventType)) {
    throw new Error('eventType must be issued|claimed|activated for invitation event');
  }

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
    metadata ? JSON.stringify(metadata) : null
  ]);

  return {
    type: 'invitation',
    id: result.rows[0].id,
    createdAt: result.rows[0].created_at
  };
}

async function insertFormEvent(client, payload) {
  const {
    formId,
    step,
    eventType,
    code,
    channel,
    wave,
    userId,
    sessionId,
    amount,
    metadata
  } = payload;

  if (!formId || typeof formId !== 'string') {
    throw new Error('formId is required for form event');
  }
  if (!eventType || typeof eventType !== 'string') {
    throw new Error('eventType is required for form event');
  }

  const insertText = `
    INSERT INTO form_events (
      form_id,
      step,
      event_type,
      code,
      channel,
      wave,
      user_id,
      session_id,
      amount,
      metadata
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING id, created_at
  `;

  const result = await client.query(insertText, [
    formId.trim(),
    step != null ? Number(step) : null,
    eventType,
    code || null,
    channel || null,
    wave || null,
    userId || null,
    sessionId || null,
    amount != null ? Number(amount) : null,
    metadata ? JSON.stringify(metadata) : null
  ]);

  return {
    type: 'form',
    id: result.rows[0].id,
    createdAt: result.rows[0].created_at
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.json({ error: 'Method Not Allowed' });
    return;
  }

  let client;
  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) {}
    }

    const { category = 'invitation', ...rest } = body || {};

    client = createClient();
    await client.connect();

    let result;
    if (category === 'form') {
      result = await insertFormEvent(client, rest);
    } else if (category === 'invitation') {
      result = await insertInvitationEvent(client, rest);
    } else {
      throw new Error('unknown category, expected "invitation" or "form"');
    }

    await client.end();

    res.statusCode = 200;
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('track error', err);
    if (client) {
      try { await client.end(); } catch (_) {}
    }
    res.statusCode = 500;
    res.json({ error: String(err) });
  }
};
