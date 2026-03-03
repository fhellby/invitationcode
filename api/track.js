// api/track.js
import { Client } from 'pg';

const connectionString = process.env.DATABASE_URL;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const { code, channel, wave, eventType, cost, metadata } = req.body || {};

    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'code is required' });
      return;
    }
    if (!channel || typeof channel !== 'string') {
      res.status(400).json({ error: 'channel is required' });
      return;
    }
    if (!['issued', 'claimed', 'activated'].includes(eventType)) {
      res.status(400).json({ error: 'eventType must be issued|claimed|activated' });
      return;
    }

    const client = new Client({ connectionString });
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

    res.status(200).json({
      success: true,
      id: result.rows[0].id,
      createdAt: result.rows[0].created_at,
    });
  } catch (err) {
    console.error('track error', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
