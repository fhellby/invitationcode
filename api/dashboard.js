// api/dashboard.js
const { Client } = require('pg');

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  return new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
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

    // 1) 顶部邀请码汇总
    const totalSql = `
      SELECT
        SUM(CASE WHEN event_type = 'issued'    THEN 1 ELSE 0 END) AS total_issued,
        SUM(CASE WHEN event_type = 'claimed'   THEN 1 ELSE 0 END) AS total_claimed,
        SUM(CASE WHEN event_type = 'activated' THEN 1 ELSE 0 END) AS total_activated
      FROM invitation_events;
    `;
    const totalResult = await client.query(totalSql);
    const totals = totalResult.rows[0] || {};

    // 2) 渠道聚合
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
    const channelData = channelResult.rows.map((row) => ({
      name: row.channel,
      issued: Number(row.issued),
      claimed: Number(row.claimed),
      activated: Number(row.activated),
      cost: Number(row.total_cost)
    }));

    // 3) 波次聚合
    const waveSql = `
      SELECT
        COALESCE(wave, 'Unknown') AS wave,
        SUM(CASE WHEN event_type = 'issued'    THEN 1 ELSE 0 END) AS issued,
        SUM(CASE WHEN event_type = 'claimed'   THEN 1 ELSE 0 END) AS claimed,
        SUM(CASE WHEN event_type = 'activated' THEN 1 ELSE 0 END) AS activated
      FROM invitation_events
      GROUP BY COALESCE(wave, 'Unknown')
      ORDER BY COALESCE(wave, 'Unknown');
    `;
    const waveResult = await client.query(waveSql);
    const waveData = waveResult.rows.map((row, index) => ({
      name: `Wave ${index + 1}`,
      range: row.wave,
      issued: Number(row.issued),
      claimed: Number(row.claimed),
      activated: Number(row.activated),
      status: 'completed'
    }));

    // 4) 每日激活趋势
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
    const labels = dailyResult.rows.map((r) => r.day);
    const activations = dailyResult.rows.map((r) => Number(r.activated));

    // 5) 表单漏斗（按 form_id）
    const formFunnelSql = `
      SELECT
        form_id,
        SUM(CASE WHEN event_type = 'view'    THEN 1 ELSE 0 END) AS views,
        SUM(CASE WHEN event_type = 'start'   THEN 1 ELSE 0 END) AS starts,
        SUM(CASE WHEN event_type = 'submit'  THEN 1 ELSE 0 END) AS submits,
        SUM(CASE WHEN event_type = 'success' THEN 1 ELSE 0 END) AS successes
      FROM form_events
      GROUP BY form_id
      ORDER BY form_id;
    `;
    const formFunnelResult = await client.query(formFunnelSql);
    const formFunnels = formFunnelResult.rows.map((row) => {
      const views = Number(row.views);
      const starts = Number(row.starts);
      const submits = Number(row.submits);
      const successes = Number(row.successes);

      return {
        formId: row.form_id,
        views,
        starts,
        submits,
        successes,
        viewToStartRate: views ? +((starts / views) * 100).toFixed(1) : 0,
        startToSubmitRate: starts ? +((submits / starts) * 100).toFixed(1) : 0,
        submitToSuccessRate: submits ? +((successes / submits) * 100).toFixed(1) : 0,
        totalSuccessRate: views ? +((successes / views) * 100).toFixed(1) : 0
      };
    });

    // 6) 表单 + 渠道明细
    const formChannelSql = `
      SELECT
        form_id,
        channel,
        SUM(CASE WHEN event_type = 'view'    THEN 1 ELSE 0 END) AS views,
        SUM(CASE WHEN event_type = 'start'   THEN 1 ELSE 0 END) AS starts,
        SUM(CASE WHEN event_type = 'submit'  THEN 1 ELSE 0 END) AS submits,
        SUM(CASE WHEN event_type = 'success' THEN 1 ELSE 0 END) AS successes
      FROM form_events
      GROUP BY form_id, channel
      ORDER BY form_id, channel;
    `;
    const formChannelResult = await client.query(formChannelSql);
    const formChannelBreakdown = formChannelResult.rows.map((row) => {
      const views = Number(row.views);
      const successes = Number(row.successes);
      return {
        formId: row.form_id,
        channel: row.channel || 'Unknown',
        views,
        starts: Number(row.starts),
        submits: Number(row.submits),
        successes,
        successRate: views ? +((successes / views) * 100).toFixed(1) : 0
      };
    });

    // 7) 表单步骤流失（按 form_id + step）
    const formStepSql = `
      SELECT
        form_id,
        step,
        SUM(CASE WHEN event_type = 'next' THEN 1 ELSE 0 END) AS nexts,
        SUM(CASE WHEN event_type = 'fail' THEN 1 ELSE 0 END) AS fails
      FROM form_events
      WHERE step IS NOT NULL
      GROUP BY form_id, step
      ORDER BY form_id, step;
    `;
    const formStepResult = await client.query(formStepSql);
    const formStepDropoff = formStepResult.rows.map((row) => ({
      formId: row.form_id,
      step: Number(row.step),
      nexts: Number(row.nexts),
      fails: Number(row.fails)
    }));

    await client.end();

    res.statusCode = 200;
    res.json({
      totals: {
        issued: Number(totals.total_issued || 0),
        claimed: Number(totals.total_claimed || 0),
        activated: Number(totals.total_activated || 0)
      },
      channelData,
      waveData,
      dailyData: {
        labels,
        activations
      },
      formFunnels,
      formChannelBreakdown,
      formStepDropoff
    });
  } catch (err) {
    console.error('dashboard error', err);
    if (client) {
      try {
        await client.end();
      } catch (_) {}
    }
    res.statusCode = 500;
    res.json({ error: String(err) });
  }
};
