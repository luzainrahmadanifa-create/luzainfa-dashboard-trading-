// Vercel Serverless Function: GET /api/prices
// Mengambil OHLC harian 100 saham KOMPAS100 dari Yahoo Finance.
// Format respons persis yang dibaca loadLive() di index.html:
//   { updated: ISO, data: { "BBCA.JK": { t:[hariSejakEpoch], o:[], h:[], l:[], c:[] } } }
// Di-cache di CDN Vercel, jadi Yahoo tidak dihantam tiap kunjungan.

// Konstituen KOMPAS100 3 Agu 2026 - 29 Jan 2027. Samakan dengan TK di index.html
// setiap rebalancing (Feb & Agu).
const TICKERS = 'AADI ACES ADMR ADRO AKRA AMMN AMRT ANTM ARCI ARTO ASII BBCA BBNI BBRI BBTN BBYB BFIN BIPI BKSL BMRI BNBR BRIS BRMS BRPT BSDE BUKA BULL BUMI BUVA CBDK CMRY COIN CPIN CTRA CUAN DEWA DSNG ELSA EMAS EMTK ENRG ERAA ESSA EXCL GGRM GOTO HEAL HRTA HRUM ICBP IMPC INCO INDF INDY INET INKP ISAT ITMG JPFA JSMR KIJA KLBF KPIG LSIP MAPA MAPI MBMA MDKA MEDC MIKA MINA MYOR NCKL PANI PGAS PGEO PNLF PSAB PTBA PTRO PWON RAJA RATU RMKE SCMA SGER SMGR SMIL SMRA SSIA TAPG TINS TLKM TOBA TOWR TPIA UNTR UNVR WIFI WIRG'.split(' ').map(s => s + '.JK');

const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function fetchOne(sym, range, attempt = 0) {
  const host = HOSTS[attempt % HOSTS.length];
  const url = `https://${host}/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=1d&includePrePost=false`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const res = j && j.chart && j.chart.result && j.chart.result[0];
    if (!res || !res.timestamp) throw new Error('no data');
    const q = res.indicators.quote[0], off = (res.meta && res.meta.gmtoffset) || 25200;
    const out = { t: [], o: [], h: [], l: [], c: [] };
    for (let i = 0; i < res.timestamp.length; i++) {
      const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
      if (o == null || h == null || l == null || c == null || !(c > 0)) continue;
      out.t.push(Math.floor((res.timestamp[i] + off) / 86400)); // tanggal bursa lokal (WIB)
      out.o.push(+o.toFixed(2)); out.h.push(+h.toFixed(2)); out.l.push(+l.toFixed(2)); out.c.push(+c.toFixed(2));
    }
    return out;
  } catch (e) {
    if (attempt < 2) return fetchOne(sym, range, attempt + 1);
    throw e;
  } finally { clearTimeout(timer); }
}

async function pool(items, limit, fn) {
  const results = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) { const i = next++; try { results[i] = await fn(items[i]); } catch (_) { results[i] = null; } }
  }));
  return results;
}

module.exports = async (req, res) => {
  const range = ['1y', '2y', '3y', '5y'].includes(req.query && req.query.range) ? req.query.range : '3y';
  const rows = await pool(TICKERS, 12, s => fetchOne(s, range));
  const data = {}, missing = [];
  TICKERS.forEach((s, i) => { rows[i] && rows[i].t.length ? (data[s] = rows[i]) : missing.push(s); });

  if (!Object.keys(data).length) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'Yahoo Finance tidak merespons' });
  }
  // Segar 15 menit; setelah itu CDN tetap menyajikan data lama sambil refresh di belakang layar.
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=86400');
  res.status(200).json({ updated: new Date().toISOString(), range, missing, data });
};
