// api/dashboard.js
const { Client } = require('pg');

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  return new Client({
    connectionString,
    ssl: { rejectUnauthorized: false } // Supabase 需要 SSL
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.json({ error: 'Method Not Allowed' });
    return;
  }

  let client;
  try {
    client = createClient();
    await client.connect();

    // 顶部汇总
    const totalSql = `
      SELECT
        SUM(CASE WHEN event_type = 'issued'    THEN 1 ELSE 0 END) AS total_issued,
        SUM(CASE WHEN event_type = 'claimed'   THEN 1 ELSE 0 END) AS total_claimed,
        SUM(CASE WHEN event_type = 'activated' THEN 1 ELSE 0 END) AS total_activated
      FROM invitation_events;
    `;
    const totalResult = await client.query(totalSql);
    const totals = totalResult.rows[0] || {};

    // 渠道聚合
    const channelSql = `
      SELECT
        channel,
        SUM(CASE WHEN event_type = 'issued'    THEN 1 ELSE 0 END) AS issued,
        SUM(CASE WHEN event_type = 'claimed'   THEN 1 ELSE 0 END) AS claimed,
        SUM(CASE WHEN event_type = 'activated' THEN 1 ELSE 0 END) AS activated,
        COALESCE(SUM(cost), 0) AS total_cost
      FROM invitation_events
      GROUP BY channel
      ORDER BY activated DESC;
    `;
    const channelResult = await client.query(channelSql);
    const channelData = channelResult.rows.map(row => ({
      name: row.channel,
      issued: Number(row.issued),
      claimed: Number(row.claimed),
      activated: Number(row.activated),
      cost: Number(row.total_cost),
    }));

    // 波次聚合
    const waveSql = `
      SELECT
        COALESCE(wave, 'Unknown') AS wave,
        SUM(CASE WHEN event_type = 'issued'    THEN 1 ELSE 0 END) AS issued,
        SUM(CASE WHEN event_type = 'claimed'   THEN 1 ELSE 0 END) AS claimed,
        SUM(CASE WHEN event_type = 'activated' THEN 1 ELSE 0 END) AS activated
      FROM invitation_events
      GROUP BY COALESCE(wave, 'Unknown')
      ORDER BY wave;
    `;
    const waveResult = await client.query(waveSql);
    const waveData = waveResult.rows.map((row, index) => ({
      name: `Wave ${index + 1}`,
      range: row.wave,
      issued: Number(row.issued),
      claimed: Number(row.claimed),
      activated: Number(row.activated),
      status: 'completed',
    }));

    // 每日激活趋势
    const dailySql = `
      SELECT
        to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
        SUM(CASE WHEN event_type = 'activated' THEN 1 ELSE 0 END) AS activated
      FROM invitation_events
      GROUP BY date_trunc('day', created_at)
      ORDER BY day
      LIMIT 30;
    `;
    const dailyResult = await client.query(dailySql);
    const labels = dailyResult.rows.map(r => r.day);
    const activations = dailyResult.rows.map(r => Number(r.activated));

    await client.end();

    res.statusCode = 200;
    res.json({
      totals: {
        issued: Number(totals.total_issued || 0),
        claimed: Number(totals.total_claimed || 0),
        activated: Number(totals.total_activated || 0),
      },
      channelData,
      waveData,
      dailyData: {
        labels,
        activations,
      },
    });
 } catch (err) {
    console.error('dashboard error', err);
    if (client) {
      try { await client.end(); } catch (_) {}
    }
    res.statusCode = 500;
    res.json({ error: String(err) });
  }
};
