// ================================================================
// CONFIGURAÇÕES GLOBAIS
// ================================================================
const TELEGRAM_TOKEN = '8670184440:AAFBfhFFTMnUWsgIFyRh0huBYbL-Q_vhT5k';
const TELEGRAM_CHAT_ID = '1137196768';
const ALERT_COOLDOWN = 60000;
let CAPITAL = 10000;
let lastAlertTime = 0;
let alertLog = [];
let telegramStatus = 'online';
let candleHistory = [];
let rsiHistory = [];
let macdHistory = [];
let obvHistory = [];
let fundingHistory = [];
let spreadHistory = [];
let tradeHistory = [];
let tradeCounter = 0;
const OPTIMIZATION_INTERVAL = 50;
let currentRegime = 'NEUTRO';
let currentWhaleState = 'accumulating';
let filterWeights = {
    price_action: 0.12, momentum: 0.12, macro_crypto: 0.10,
    liquidity_spread: 0.08, ml_probability: 0.08, mtf_alignment: 0.10,
    volume_liquidity: 0.12, funding_onchain: 0.14,
    divergence_penalty: 0.10, trend_strength: 0.14
};
let atrPercentHistory = [];
let regimeWeights = {
    BULL: { trend: 0.30, momentum: 0.25, structure: 0.10, onChain: 0.10, volume: 0.10, oi: 0.15 },
    BEAR: { trend: 0.30, momentum: 0.25, structure: 0.10, onChain: 0.10, volume: 0.10, oi: 0.15 },
    RANGE: { trend: 0.10, momentum: 0.20, structure: 0.25, onChain: 0.20, volume: 0.10, oi: 0.15 }
};
const STOP_PARAMS_V8 = {
    SQUEEZE: { stop: 1.0, tp1: 0.8, tp2: 1.5, tp3: 2.5 },
    LOW: { stop: 1.5, tp1: 1.2, tp2: 2.0, tp3: 3.5 },
    NORMAL: { stop: 2.0, tp1: 1.8, tp2: 3.5, tp3: 4.5 },
    HIGH: { stop: 3.0, tp1: 2.5, tp2: 5.0, tp3: 6.0 }
};
let globalData = {
    price: 60000, ema50: 65000, ema200: 62000,
    rsi: 45, macd: 120, macdSignal: 100,
    roc: -2.5, support: 58000, resistance: 70000,
    fvgZones: [{ low: 62000, high: 63500 }],
    mvrv: 1.2, sopr: 0.95, volumeRel: 1.0, oiDelta: 0.0
};
let componentWeights = { trend: 0.25, momentum: 0.20, structure: 0.15, onchain: 0.10, volume: 0.15, oi: 0.15 };
let ema50History = [];


// ================================================================
// HISTÓRICO DE SCORE (GRÁFICO)
// ================================================================
let scoreHistory = [];
const MAX_SCORE_HISTORY = 2000;
let scoreChart = null;
let currentScoreTimeframe = '1h';


// ================================================================
// TELEGRAM (MANTIDO)
// ================================================================
async function sendTelegramAlert(message) {
    try {
        const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' })
        });
        if (r.ok) { telegramStatus = 'online'; updateTelegramStatus(); return true; }
        else { console.warn('❌ Falha no alerta:', await r.text()); telegramStatus = 'offline'; updateTelegramStatus(); return false; }
    } catch (e) { console.warn('❌ Erro no alerta:', e); telegramStatus = 'offline'; updateTelegramStatus(); return false; }
}
async function sendStructuredAlert(signalType, score, price, stop, targets, rationale, components) {
    const kellyPct = calculateKellySizingByRegime(currentRegime);
    const riskAmount = CAPITAL * kellyPct, riskPerUnit = Math.abs(price - stop), size = riskAmount / riskPerUnit;
    const sizeDisplay = size.toFixed(2);
    const emojis = { long: '🟢', short: '🔴' };
    let msg = `${emojis[signalType]} <b>SINAL ${signalType.toUpperCase()} - BTCUSDT</b>\n`;
    msg += `Confiança: ${Math.round(score)}%\nPreço: $${price.toFixed(2)}\nStop: $${stop.toFixed(2)}\n`;
    msg += `Tamanho sugerido: ${sizeDisplay} BTC (${(kellyPct*100).toFixed(2)}% do capital)\nAlvos:\n`;
    targets.forEach(t => { msg += `  ${t.label}: $${t.price.toFixed(2)} (${(t.size*100).toFixed(0)}% posição, R:R ${t.rr.toFixed(1)})\n`; });
    msg += `Score: ${Math.round(score)}/100\nRegime: ${currentRegime}\n`;
    if (components) msg += `Componentes: Tendência ${components.trend}, Momentum ${components.momentum}, Estrutura ${components.structure}, On-Chain ${components.onchain}, Volume ${components.volume}, OI ${components.oi}\n`;
    const prob = getHistoricalWinrate({ signal: signalType, score: score });
    msg += `Probabilidade estimada: ${(prob*100).toFixed(0)}%\nFundamentos: ${rationale}\n⏰ ${getCurrentTimestamp()}`;
    const success = await sendTelegramAlert(msg);
    if (success) {
        alertLog.push({ timestamp: Date.now(), type: signalType, score, price, rationale, components, win: null, pnl: null,
            regime: currentRegime });
        localStorage.setItem('alertLog', JSON.stringify(alertLog.slice(-100)));
    }
    return success;
}
async function sendTestAlert() {
    const score = document.getElementById('score-value')?.textContent || '50';
    const price = document.getElementById('btc-price')?.textContent || '$60.000';
    const ts = getCurrentTimestamp();
    return await sendTelegramAlert(`🔔 <b>TESTE DE CONEXÃO</b>\n✅ Status: CONECTADO\n📊 Score: ${score}\n💰 BTC: ${price}\n⏰ ${ts}`);
}
function updateTelegramStatus() {
    const dot = document.getElementById('telegram-status-dot');
    const badge = document.getElementById('telegram-badge');
    const statusText = document.getElementById('telegram-status-text');
    if (dot) dot.className = 'telegram-status ' + (telegramStatus === 'online' ? 'online' : 'offline');
    if (badge) badge.className = 'telegram-badge ' + (telegramStatus === 'online' ? '' : 'error');
    if (statusText) statusText.textContent = telegramStatus === 'online' ? '🟢 Conectado' : '🔴 Desconectado';
}


// ================================================================
// HELPERS BASE
// ================================================================
function getHistoricalWinrate(cond) {
    const log = alertLog.filter(t => t.type === cond.signal && t.win !== null);
    if (!log.length) return 0.5;
    return log.filter(t => t.win).length / log.length;
}
function calculateATR(closes, period = 14) {
    if (closes.length < period + 1) return closes[closes.length - 1] * 0.02;
    const tr = [];
    for (let i = 1; i < closes.length; i++) tr.push(Math.abs(closes[i] - closes[i - 1]));
    return tr.slice(-period).reduce((a, b) => a + b, 0) / period;
}
function calculateEMA(data, period) {
    if (!data || data.length < period) return null;
    const mult = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b) / period;
    for (let i = period; i < data.length; i++) ema = (data[i] - ema) * mult + ema;
    return ema;
}
function calculateRSI(data, period = 14) {
    if (data.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = data[i] - data[i - 1];
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    let avgGain = gains / period, avgLoss = losses / period;
    for (let i = period + 1; i < data.length; i++) {
        const diff = data[i] - data[i - 1];
        if (diff >= 0) { avgGain = (avgGain * (period - 1) + diff) / period;
            avgLoss = (avgLoss * (period - 1)) / period; } else { avgGain = (avgGain * (period - 1)) / period;
            avgLoss = (avgLoss * (period - 1) - diff) / period; }
    }
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + (avgGain / avgLoss)));
}
function calculateMACD(data, fast = 12, slow = 26, signal = 9) {
    if (data.length < slow + signal) return null;
    const eFast = calculateEMA(data, fast), eSlow = calculateEMA(data, slow);
    if (!eFast || !eSlow) return null;
    return eFast - eSlow;
}
function calculateOBV(candles) {
    if (!candles || candles.length < 2) return 0;
    let obv = 0;
    for (let i = 1; i < candles.length; i++) {
        const c = candles[i].close, pc = candles[i - 1].close, v = candles[i].volume || 0;
        if (c > pc) obv += v;
        else if (c < pc) obv -= v;
    }
    return obv;
}
function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }
function getCurrentTimestamp() {
    return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: 'short',
        day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function formatCurrency(v) { return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2,
        maximumFractionDigits: 2 }); }
function getChangeClass(v) { return parseFloat(v) >= 0 ? 'positive' : 'negative'; }


// ================================================================
// KELLY SEGMENTADO
// ================================================================
function calculateKellySizingByRegime(regime) {
    const baseRisk = regime === 'RANGE' ? 0.005 : 0.02;
    const maxRisk = regime === 'RANGE' ? 0.01 : 0.05;
    const regimeTrades = alertLog.filter(t => t.win !== null && t.regime === regime).slice(-50);
    if (regimeTrades.length < 10) return baseRisk;
    const wins = regimeTrades.filter(t => t.win).length;
    const wr = wins / regimeTrades.length;
    const avgWin = regimeTrades.filter(t => t.win).reduce((s, t) => s + (t.pnl || 0), 0) / Math.max(1, wins);
    const avgLoss = Math.abs(regimeTrades.filter(t => !t.win).reduce((s, t) => s + (t.pnl || 0), 0)) / Math.max(1,
        regimeTrades.length - wins);
    const kelly = (wr * avgWin - (1 - wr) * avgLoss) / avgWin;
    const safeKelly = Math.max(0, kelly * 0.25);
    return Math.min(maxRisk, Math.max(0.005, safeKelly));
}


// ================================================================
// REGIME CORRIGIDO (com detecção correta de slope)
// ================================================================
function detectMarketRegimeFixed(price, ema50, ema50Prev, ema200, adx) {
    const slope = (ema50Prev !== undefined && ema50Prev > 0) ? (ema50 - ema50Prev) / ema50Prev : 0;
    const isTrend = adx > 25;
    const isBullish = price > ema50 && ema50 > ema200 && slope > 0.0005;
    const isBearish = price < ema50 && ema50 < ema200 && slope < -0.0005;
    if (isBullish && isTrend) return 'BULL';
    if (isBearish && isTrend) return 'BEAR';
    return 'RANGE';
}
function updateRegimeDisplay(regime) {
    const el = document.getElementById('header-regime');
    if (!el) return;
    currentRegime = regime;
    el.textContent = `⚡ REGIME: ${regime}`;
    el.className = 'badge badge-regime ' + regime.toLowerCase();
}


// ================================================================
// CHOPPINESS
// ================================================================
function choppinessIndex(candles, period = 14) {
    if (!candles || candles.length < period) return 100;
    const slice = candles.slice(-period);
    const highs = slice.map(c => c.high), lows = slice.map(c => c.low), closes = slice.map(c => c.close);
    const atr = calculateATR(closes, period);
    const range = Math.max(...highs) - Math.min(...lows);
    if (range === 0) return 100;
    return 100 * Math.log10(atr / range) / Math.log10(period);
}


// ================================================================
// SUPORTE/RESISTÊNCIA HORIZONTAL
// ================================================================
function getHorizontalSR(candles) {
    if (!candles || candles.length < 24) return { support: 0, resistance: 0 };
    const day = candles.slice(-24);
    const week = candles.slice(-168);
    const month = candles.slice(-720);
    const sD = Math.min(...day.map(c => c.low)), rD = Math.max(...day.map(c => c.high));
    const sW = week.length ? Math.min(...week.map(c => c.low)) : sD;
    const rW = week.length ? Math.max(...week.map(c => c.high)) : rD;
    const sM = month.length ? Math.min(...month.map(c => c.low)) : sW;
    const rM = month.length ? Math.max(...month.map(c => c.high)) : rW;
    return { support: Math.min(sD, sW, sM), resistance: Math.max(rD, rW, rM) };
}


// ================================================================
// OTIMIZAÇÃO DE PESOS
// ================================================================
function evalWeights(weights, dataset) {
    const names = Object.keys(filterWeights);
    let correct = 0;
    for (const trade of dataset) {
        const features = trade.features || {};
        let score = 0;
        names.forEach((name, idx) => { score += (features[name] || 50) * weights[idx]; });
        score = Math.min(100, Math.max(0, score));
        const pred = score >= 55 ? 1 : 0;
        if (pred === (trade.outcome ? 1 : 0)) correct++;
    }
    return correct / dataset.length;
}
function optimizeWeightsV6(history) {
    if (history.length < 30) return null;
    const shuffled = [...history].sort(() => Math.random() - 0.5);
    const trainIdx = Math.floor(shuffled.length * 0.7);
    const train = shuffled.slice(0, trainIdx), val = shuffled.slice(trainIdx);
    const names = Object.keys(filterWeights);
    let bestW = names.map(n => filterWeights[n]), bestScore = evalWeights(bestW, train);
    let curW = [...bestW], curScore = bestScore;
    for (let iter = 0; iter < 100; iter++) {
        const temp = 1 * (1 - iter / 100);
        const neighbor = curW.map(w => {
            let nw = w + (Math.random() - 0.5) * 0.05 * (temp + 0.05);
            return Math.max(0.01, Math.min(0.5, nw));
        });
        const sum = neighbor.reduce((a, b) => a + b, 0);
        const norm = neighbor.map(w => w / sum);
        const nScore = evalWeights(norm, train);
        if (nScore > curScore || Math.random() < Math.exp((nScore - curScore) / (temp + 0.001))) {
            curW = norm;
            curScore = nScore;
            if (nScore > bestScore) { bestW = [...norm];
                bestScore = nScore; }
        }
    }
    const valScore = evalWeights(bestW, val);
    if (valScore < bestScore * 0.85) console.warn('⚠️ Overfitting detectado!');
    const result = {};
    names.forEach((n, i) => result[n] = bestW[i]);
    return result;
}
function updateFilterWeightsV6() {
    if (tradeHistory.length < OPTIMIZATION_INTERVAL) return;
    const recent = tradeHistory.slice(-OPTIMIZATION_INTERVAL);
    const newW = optimizeWeightsV6(recent);
    if (newW) { Object.assign(filterWeights, newW);
        localStorage.setItem('filterWeightsV6', JSON.stringify(filterWeights)); }
}
function loadWeightsV6() {
    const saved = localStorage.getItem('filterWeightsV6');
    if (saved) try { Object.assign(filterWeights, JSON.parse(saved)); } catch (e) {}
}


// ================================================================
// MTF (CORRIGIDO: FALLBACK NEUTRO)
// ================================================================
async function fetchMTFData(symbol = 'BTCUSDT') {
    try {
        const [c1h, c4h, c1d] = await Promise.all([
            fetchCandles(symbol, '1h', 50),
            fetchCandles(symbol, '4h', 50),
            fetchCandles(symbol, '1d', 50)
        ]);
        return { c1h: c1h || [], c4h: c4h || [], c1d: c1d || [] };
    } catch (e) { console.warn('MTF fetch error:', e); return { c1h: [], c4h: [], c1d: [] }; }
}
function buildHistoricalMTF(dataset4h, uptoIndex) {
    const slice = dataset4h.slice(0, uptoIndex + 1);
    const c4h = slice.slice(-50);
    const c1d = [];
    for (let i = slice.length - 1; i >= 5 && c1d.length < 50; i -= 6) {
        const block = slice.slice(Math.max(0, i - 5), i + 1);
        if (block.length === 0) break;
        c1d.unshift({
            close: block[block.length - 1].close,
            high: Math.max(...block.map(c => c.high)),
            low: Math.min(...block.map(c => c.low))
        });
    }
    return { c1h: c4h, c4h: c4h, c1d: c1d.length > 0 ? c1d : c4h };
}
function getTrendEMA(candles) {
    if (!candles || candles.length < 50) return 0;
    const closes = candles.map(d => d.close);
    const ema50 = calculateEMA(closes, 50), ema200 = calculateEMA(closes, 200);
    if (!ema50 || !ema200) return 0;
    return ema50 > ema200 ? 1 : -1;
}
function checkMTFAlignment(mtf, signal, price) {
    const { c1h, c4h, c1d } = mtf;
    if (c1h.length < 50 || c4h.length < 50 || c1d.length < 50) return { aligned: false, reason: 'MTF data insufficient' };
    const t1h = getTrendEMA(c1h), t4h = getTrendEMA(c4h), t1d = getTrendEMA(c1d);
    if (t1h === 0 || t4h === 0 || t1d === 0) return { aligned: false, reason: 'MTF trend undefined' };
    if (t1h !== t4h || t4h !== t1d) return { aligned: false, reason: 'MTF mismatch' };
    const support = Math.min(...c1h.slice(-20).map(d => d.low)), resistance = Math.max(...c1h.slice(-20).map(d => d.high));
    if (signal === 'LONG' && price > support && t1h === 1) return { aligned: true, reason: '' };
    if (signal === 'SHORT' && price < resistance && t1h === -1) return { aligned: true, reason: '' };
    return { aligned: false, reason: 'Price side vs structure' };
}


// ================================================================
// BOOK DEPTH (CORRIGIDO: NÃO BLOQUEIA O BACKTEST)
// ================================================================
async function fetchOrderBookDepth(symbol, limit = 20) {
    try {
        const r = await fetch(`https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=${limit}`);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        return {
            bids: data.bids.map(([p, q]) => [parseFloat(p), parseFloat(q)]),
            asks: data.asks.map(([p, q]) => [parseFloat(p), parseFloat(q)])
        };
    } catch (e) { console.warn('Order book depth error:', e); return null; }
}
async function checkClusterOrders(symbol, price, side, tolerance = 0.005) {
    const depth = await fetchOrderBookDepth(symbol, 10);
    if (!depth) return null;
    const levels = side === 'BUY' ? depth.asks : depth.bids;
    const targetPrice = side === 'BUY' ? price * (1 + tolerance) : price * (1 - tolerance);
    let volume = 0;
    for (const [p, q] of levels) {
        if (side === 'BUY' && p > targetPrice) break;
        if (side === 'SELL' && p < targetPrice) break;
        volume += q;
    }
    return { cluster: volume > 10, volume };
}


// ================================================================
// BAND WIDTH
// ================================================================
function calculateBollingerBandWidth(candles, period = 20, mult = 2) {
    if (candles.length < period) return 0;
    const closes = candles.slice(-period).map(c => c.close);
    const sma = closes.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(closes.reduce((a, b) => a + (b - sma) ** 2, 0) / period);
    return (2 * mult * std) / sma;
}


// ================================================================
// WHALE CONFLUENCE (CORRIGIDO: AGORA APLICA AO TAMANHO)
// ================================================================
function getWhaleConfluenceMultiplier(signal, whaleAction) {
    const whaleBullish = whaleAction === 'accumulating';
    const whaleBearish = whaleAction === 'distributing';
    if (signal === 'LONG' && whaleBearish) return 0.5;
    if (signal === 'SHORT' && whaleBullish) return 0.5;
    return 1.0;
}


// ================================================================
// LIQUIDEZ
// ================================================================
function getLiquidityRegime() {
    const now = new Date();
    const day = now.getUTCDay();
    const hour = now.getUTCHours();
    const isDeadHour = hour >= 0 && hour < 2;
    if (isDeadHour) return { tradeable: false, scorePenalty: 0 };
    if (day === 0 || day === 6) return { tradeable: true, scorePenalty: 8 };
    return { tradeable: true, scorePenalty: 0 };
}


// ================================================================
// SUPORTE/RESISTÊNCIA DINÂMICO
// ================================================================
function updateLiveSupportResistance() {
    if (candleHistory.length < 20) return;
    const sr = getHorizontalSR(candleHistory);
    globalData.support = sr.support || 58000;
    globalData.resistance = sr.resistance || 70000;
}


// ================================================================
// ESTRATÉGIAS (REGIME-AWARE, BOS/CHoCH, FUNDING Z-SCORE, OI DIRECIONAL)
// ================================================================
function getRegimeAwareSignal(simData, regime) {
    if (regime === 'RANGE') {
        const range = simData.resistance - simData.support;
        if (range <= 0) return 'NEUTRAL';
        const pos = (simData.price - simData.support) / range;
        if (pos < 0.15 && simData.rsi < 35) return 'LONG';
        if (pos > 0.85 && simData.rsi > 65) return 'SHORT';
        return 'NEUTRAL';
    }
    const distFromEma50Pct = simData.ema50 ? Math.abs(simData.price - simData.ema50) / simData.ema50 * 100 : 100;
    const isPullback = distFromEma50Pct < 2;
    if (regime === 'BULL' && isPullback && simData.rsi > 45 && simData.rsi < 65) return 'LONG';
    if (regime === 'BEAR' && isPullback && simData.rsi < 55 && simData.rsi > 35) return 'SHORT';
    return 'NEUTRAL';
}
function detectStructureBreak(candles, lookback = 10) {
    if (!candles || candles.length < lookback + 2) return { type: null, level: null };
    const recent = candles.slice(-lookback - 1, -1);
    const current = candles[candles.length - 1];
    const swingHigh = Math.max(...recent.map(c => c.high));
    const swingLow = Math.min(...recent.map(c => c.low));
    if (current.close > swingHigh) return { type: 'BOS_UP', level: swingHigh };
    if (current.close < swingLow) return { type: 'BOS_DOWN', level: swingLow };
    return { type: null, level: null };
}
function getPriceActionScore(candles, signal) {
    const sb = detectStructureBreak(candles, 10);
    if (signal === 'LONG' && sb.type === 'BOS_UP') return 80;
    if (signal === 'SHORT' && sb.type === 'BOS_DOWN') return 80;
    if (sb.type === null) return 45;
    return 25;
}
function getFundingZScore(currentFunding, fundingHistory) {
    if (!fundingHistory || fundingHistory.length < 10) return 0;
    const values = fundingHistory.map(f => f.fundingRate);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const std = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
    if (std === 0) return 0;
    return (currentFunding - mean) / std;
}
function classifyOIRisk(oiDeltaPct, priceDeltaPct) {
    if (oiDeltaPct > 10 && priceDeltaPct > 1) return 'HEALTHY_LONG';
    if (oiDeltaPct > 10 && priceDeltaPct < -1) return 'SQUEEZE_RISK_SHORT';
    if (oiDeltaPct > 10 && Math.abs(priceDeltaPct) <= 1) return 'SQUEEZE_RISK_LONG';
    return 'NEUTRAL';
}


// ================================================================
// CONFIRMAÇÃO DE SINAL V13 (CORRIGIDO)
// ================================================================
function getDynamicWeights(regime) { return regimeWeights[regime] || regimeWeights.BULL; }
function getDynamicFilterWeights(regime) {
    const base = { ...filterWeights };
    if (regime === 'RANGE') { base.structure = 0.20;
        base.trend = 0.08;
        base.volume = 0.08; } else { base.trend = 0.25;
        base.structure = 0.10;
        base.volume = 0.12; }
    return base;
}
function detectDivergenceClassicV8(candles, indicatorVals, signal, atr) {
    if (!candles || !indicatorVals || candles.length < 10) return false;
    const priceRange = Math.max(...candles.map(c => c.high)) - Math.min(...candles.map(c => c.low));
    const atrPct = atr / (priceRange || 1);
    let period = atrPct > 0.03 ? 3 : atrPct > 0.015 ? 5 : 7;
    period = Math.min(period, Math.floor(candles.length / 2));
    if (candles.length < period * 2) return false;
    const recentC = candles.slice(-period), recentI = indicatorVals.slice(-period);
    const priceLow = Math.min(...recentC.map(c => c.low)), indLow = Math.min(...recentI);
    const prevC = candles.slice(-(period * 2), -period), prevI = indicatorVals.slice(-(period * 2), -period);
    if (prevC.length === 0 || prevI.length === 0) return false;
    const prevPriceLow = Math.min(...prevC.map(c => c.low)), prevIndLow = Math.min(...prevI);
    const bullish = priceLow < prevPriceLow && indLow > prevIndLow;
    const priceHigh = Math.max(...recentC.map(c => c.high)), indHigh = Math.max(...recentI);
    const prevPriceHigh = Math.max(...prevC.map(c => c.high)), prevIndHigh = Math.max(...prevI);
    const bearish = priceHigh > prevPriceHigh && indHigh < prevIndHigh;
    if (signal === 'LONG') return bullish;
    if (signal === 'SHORT') return bearish;
    return false;
}
function detectDivergenceMultiV8(candles, rsiVals, macdVals, obvVals, signal, atr) {
    if (!candles || candles.length < 20) return 0;
    let score = 0;
    const rsiDiv = detectDivergenceClassicV8(candles, rsiVals, signal, atr);
    const macdDiv = detectDivergenceClassicV8(candles, macdVals, signal, atr);
    const obvDiv = detectDivergenceClassicV8(candles, obvVals, signal, atr);
    const count = [rsiDiv, macdDiv, obvDiv].filter(Boolean).length;
    if (count >= 2) score += 30;
    else if (count === 1) score += 15;
    const bearishDiv = detectDivergenceClassicV8(candles, rsiVals, 'SHORT', atr);
    const bullishDiv = detectDivergenceClassicV8(candles, rsiVals, 'LONG', atr);
    if (signal === 'LONG' && bearishDiv) score -= 40;
    if (signal === 'SHORT' && bullishDiv) score -= 40;
    return clamp(score, -40, 40);
}
function detectVolumeDeltaDivergence(candles, obvVals, signal) {
    if (!candles || candles.length < 10 || !obvVals || obvVals.length < 10) return 0;
    const recentC = candles.slice(-5), recentOBV = obvVals.slice(-5);
    const priceLow = Math.min(...recentC.map(c => c.low)), obvLow = Math.min(...recentOBV);
    const prevC = candles.slice(-10, -5), prevOBV = obvVals.slice(-10, -5);
    if (prevC.length === 0 || prevOBV.length === 0) return 0;
    const prevPriceLow = Math.min(...prevC.map(c => c.low)), prevObvLow = Math.min(...prevOBV);
    const bullishDiv = priceLow < prevPriceLow && obvLow > prevObvLow;
    const priceHigh = Math.max(...recentC.map(c => c.high)), obvHigh = Math.max(...recentOBV);
    const prevPriceHigh = Math.max(...prevC.map(c => c.high)), prevObvHigh = Math.max(...prevOBV);
    const bearishDiv = priceHigh > prevPriceHigh && obvHigh < prevObvHigh;
    if ((bullishDiv && signal === 'LONG') || (bearishDiv && signal === 'SHORT')) return 20;
    if ((bullishDiv && signal === 'SHORT') || (bearishDiv && signal === 'LONG')) return -30;
    return 0;
}
function getStopLossV8(regime, atr, price, side, support, resistance) {
    const mult = regime === 'RANGE' ? 1.5 : 2.5;
    let stop = side === 'LONG' ? price - atr * mult : price + atr * mult;
    if (side === 'LONG' && support && stop < support) stop = support * 0.995;
    if (side === 'SHORT' && resistance && stop > resistance) stop = resistance * 1.005;
    return stop;
}
function updateTrailingStopV8(regime, position, currentPrice, atr, support, resistance) {
    let newStop = position.stop;
    const mult = regime === 'RANGE' ? 0.8 : 1.5;
    if (position.side === 'LONG') {
        const atrStop = currentPrice - atr * mult, srStop = support || 0;
        newStop = Math.max(atrStop, srStop);
        if (position.tp1Hit && newStop < position.entryPrice) newStop = position.entryPrice + atr * 0.2;
    } else {
        const atrStop = currentPrice + atr * mult, srStop = resistance || Infinity;
        newStop = Math.min(atrStop, srStop);
        if (position.tp1Hit && newStop > position.entryPrice) newStop = position.entryPrice - atr * 0.2;
    }
    return newStop;
}
function generateScaledTargetsV8(entry, stop, signalType, volatilityRegime, regime) {
    const risk = Math.abs(entry - stop);
    let p;
    if (regime === 'RANGE') p = { tp1: 1.5, tp2: 2.5, tp3: 3.5 };
    else p = { tp1: 2.0, tp2: 3.5, tp3: 5.0 };
    const slippageBps = 5, fees = 0.001;
    const configs = [{ rr: p.tp1, size: 0.30, label: 'TP1' }, { rr: p.tp2, size: 0.30, label: 'TP2' }, { rr: p.tp3,
            size: 0.40, label: 'TP3' }];
    if (regime === 'RANGE') { configs[1].size = 0.70;
        configs[2].size = 0; }
    return configs.filter(c => c.size > 0).map((config, idx) => {
        const targetBruto = signalType === 'LONG' ? entry + config.rr * risk : entry - config.rr * risk;
        const slippageAdj = targetBruto * (slippageBps / 10000) * (idx + 1);
        const targetReal = signalType === 'LONG' ? targetBruto - slippageAdj : targetBruto + slippageAdj;
        const targetAdjusted = signalType === 'LONG' ? targetReal * (1 - fees) : targetReal / (1 - fees);
        const pnlReal = signalType === 'LONG' ? (targetAdjusted - entry) / risk : (entry - targetAdjusted) / risk;
        return { label: config.label, price: targetReal, size: config.size, rr: config.rr, rr_real: pnlReal,
            slippageAdj: slippageAdj / targetBruto, signalType: signalType };
    });
}
function updateBreakevenStopV8(position, targetHit, atr, regime) {
    if (targetHit === 'TP1') {
        const buffer = atr * (regime === 'RANGE' ? 0.3 : 0.5);
        if (position.side === 'LONG') position.stop = position.entryPrice + (position.entryPrice * 0.002) + buffer;
        else position.stop = position.entryPrice - (position.entryPrice * 0.002) - buffer;
        position.breakeven = true;
        position.breakeven_stop = position.stop;
        console.log(`✅ Breakeven @ $${position.stop.toFixed(2)} (buffer: ${buffer.toFixed(2)})`);
    }
}
function getTrendStrength(candles) {
    if (!candles || candles.length < 20) return { adx: 20, slope: 0, trending: false };
    const closes = candles.map(d => d.close);
    const gains = [],
        losses = [];
    for (let i = 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) gains.push(diff);
        else losses.push(-diff);
    }
    const period = 14;
    const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
    const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const adx = Math.min(100, (rs / (1 + rs)) * 100);
    const ema20 = calculateEMA(closes, 20), ema50 = calculateEMA(closes, 50);
    const slope = ema20 && ema50 ? (ema20 - ema50) / ema50 * 100 : 0;
    return { adx, slope, trending: adx > 25 && Math.abs(slope) > 0.5 };
}
async function confirmSignalV13(signal, data, candles, rsiVals, macdVals, obvVals, mtfData, isBacktest = false, clusterData = null) {
    if (!signal || signal === 'NEUTRAL') {
        return { approved: false, score: 0, reasons: ['Sinal neutro'], regime: 'NEUTRO', required: 60, scoreBonus: 0,
            scoreComponents: {} };
    }


    const liquidity = getLiquidityRegime();
    if (!liquidity.tradeable && !isBacktest) {
        return { approved: false, score: 0, reasons: ['Madrugada UTC — book fino'], regime: 'NEUTRO', required: 60,
            scoreBonus: 0, scoreComponents: {} };
    }


    const closes = candles.map(c => c.close);
    const ema50 = calculateEMA(closes, 50) || data.price;
    const ema200 = calculateEMA(closes, 200) || data.price;
    const adx = data.adx || 25;
    const atr = data.atr || calculateATR(closes) || data.price * 0.02;
    const atrPct = (atr / data.price) * 100;
    atrPercentHistory.push(atrPct);
    if (atrPercentHistory.length > 100) atrPercentHistory.shift();


    const ema50Prev = data.ema50Prev !== undefined ? data.ema50Prev : ema50;
    const regime = detectMarketRegimeFixed(data.price, ema50, ema50Prev, ema200, adx);
    updateRegimeDisplay(regime);
    currentRegime = regime;


    if (!isBacktest && regime === 'RANGE') {
        const ci = choppinessIndex(candles, 14);
        if (ci > 60) {
            return { approved: false, score: 0, reasons: [`Choppiness ${ci.toFixed(0)}% > 60`], regime, required: 75,
                scoreBonus: 0, scoreComponents: {} };
        }
    }


    const bbWidth = calculateBollingerBandWidth(candles, 20, 2);
    let volatilityRegime = 'NORMAL';
    if (bbWidth > 0 && bbWidth < 0.05) volatilityRegime = 'SQUEEZE';
    else if (bbWidth > 0.15) volatilityRegime = 'HIGH';
    else if (bbWidth > 0.08) volatilityRegime = 'NORMAL';
    else volatilityRegime = 'LOW';


    if (data.volume && data.avgVolume) {
        const volRel = data.volume / data.avgVolume;
        const threshold = isBacktest ? 1.0 : 1.4;
        if (volRel < threshold) {
            return { approved: false, score: 0, reasons: [`Volume relativo ${volRel.toFixed(2)} < ${threshold}`],
                regime, required: 65, scoreBonus: 0, scoreComponents: {} };
        }
        if (!isBacktest) {
            const recentVolumes = candles.slice(-5).map(c => c.volume || 0);
            const maxVol = Math.max(...recentVolumes);
            if (data.volume < maxVol) {
                return { approved: false, score: 0, reasons: ['Volume não é o maior dos últimos 5'], regime,
                    required: 65, scoreBonus: 0, scoreComponents: {} };
            }
        }
    }


    let clusterPenalty = 0;
    if (clusterData === null) {
        if (!isBacktest) clusterPenalty = 5;
        else clusterPenalty = 0;
    } else if (clusterData && clusterData.cluster && clusterData.volume > 15) {
        return { approved: false, score: 0, reasons: ['Cluster de ordens no caminho'], regime, required: 65,
            scoreBonus: 0, scoreComponents: {} };
    }


    let mtfPenalty = 0;
    if (mtfData && mtfData.c1h && mtfData.c1h.length > 0 && mtfData.c4h && mtfData.c4h.length > 0 && mtfData.c1d && mtfData
        .c1d.length > 0) {
        const mtfResult = checkMTFAlignment(mtfData, signal, data.price);
        if (!mtfResult.aligned) {
            mtfPenalty = isBacktest ? -8 : -15;
        }
    } else {
        mtfPenalty = isBacktest ? -5 : -10;
    }


    const dynWeights = getDynamicWeights(regime);
    componentWeights = { trend: dynWeights.trend, momentum: dynWeights.momentum, structure: dynWeights.structure,
        onchain: dynWeights.onChain, volume: dynWeights.volume, oi: dynWeights.oi };
    const minScore = regime === 'RANGE' ? 75 : 65;
    const baseRequired = isBacktest ? 50 : minScore;
    const requiredScore = baseRequired + (isBacktest ? 0 : liquidity.scorePenalty + clusterPenalty);


    const dynamic = getDynamicLevels(candles);
    const horizontal = getHorizontalSR(candles);
    const support = Math.max(dynamic.support, horizontal.support);
    const resistance = Math.min(dynamic.resistance, horizontal.resistance);


    let pa_score = getPriceActionScore(candles, signal);
    if (data.price && support && resistance && pa_score === 45) {
        const range = resistance - support;
        const pos = (data.price - support) / range;
        if (signal === 'LONG') {
            if (pos > 0.7) pa_score = 75;
            else if (pos > 0.5) pa_score = 65;
            else if (pos < 0.3) pa_score = 45;
            else pa_score = 55;
        } else {
            if (pos < 0.3) pa_score = 75;
            else if (pos < 0.5) pa_score = 65;
            else if (pos > 0.7) pa_score = 45;
            else pa_score = 55;
        }
    }


    const rsi = data.rsi || 50;
    let momentum_score = 50;
    const over = (signal === 'LONG' && rsi > 70) || (signal === 'SHORT' && rsi < 30);
    const ali = (signal === 'LONG' && rsi > 50) || (signal === 'SHORT' && rsi < 50);
    if (over) momentum_score = 35;
    else if (ali) momentum_score = 65;


    let macro_score = 50;
    const good = (data.mvrv && data.mvrv < 0.85) && (data.sopr && data.sopr < 0.9);
    const bad = (data.mvrv && data.mvrv > 1.3) && (data.sopr && data.sopr > 1.1);
    if (good) macro_score = 75;
    else if (bad) macro_score = 25;


    let liq_score = isBacktest ? 60 : 50;
    const ml_prob = predictDirectionV3(data);
    const ml_score = 20 + ml_prob * 60;


    let mtf_score = 50;
    if (mtfData && mtfData.c1h && mtfData.c1h.length > 0) {
        const mtfResult = checkMTFAlignment(mtfData, signal, data.price);
        mtf_score = mtfResult.aligned ? 85 : 20;
    }


    let vol_score = 50;
    if (data.volume && data.avgVolume) {
        const volRel = data.volume / data.avgVolume;
        if (volRel > 1.5) vol_score = 70;
        else if (volRel > 1.0) vol_score = 60;
        else vol_score = 40;
    }


    const fundingZ = getFundingZScore(data.fundingRate || 0, fundingHistory);
    let funding_score = 50;
    if (signal === 'LONG' && fundingZ < -2) funding_score = 75;
    else if (signal === 'SHORT' && fundingZ > 2) funding_score = 75;
    else if (signal === 'LONG' && fundingZ > 2) funding_score = 30;
    else if (signal === 'SHORT' && fundingZ < -2) funding_score = 30;
    else if (Math.abs(fundingZ) > 1 && Math.abs(fundingZ) < 2) funding_score = 55;
    else funding_score = 50;


    const oiRisk = classifyOIRisk(data.oiDelta || 0, data.priceDeltaPct || 0);
    let oi_score = 50;
    if (signal === 'LONG' && oiRisk === 'HEALTHY_LONG') oi_score = 80;
    else if (signal === 'SHORT' && oiRisk === 'SQUEEZE_RISK_SHORT') oi_score = 80;
    else if (signal === 'LONG' && oiRisk === 'SQUEEZE_RISK_LONG') oi_score = 30;
    else if (signal === 'SHORT' && oiRisk === 'SQUEEZE_RISK_SHORT') oi_score = 30;
    else oi_score = 50;


    let div_score = 50;
    if (candles && candles.length > 0 && rsiVals && rsiVals.length > 0) {
        const divPenalty = detectDivergenceMultiV8(candles, rsiVals, macdVals, obvVals, signal, atr);
        div_score = Math.min(70, Math.max(30, 50 + divPenalty));
        const vdd = detectVolumeDeltaDivergence(candles, obvVals, signal);
        div_score = clamp(div_score + vdd, 20, 90);
    }


    let trend_score = 50;
    if (candles && candles.length > 0) {
        const { adx, trending } = getTrendStrength(candles);
        if (trending && adx > 40) trend_score = 80;
        else if (trending) trend_score = 70;
        else if (adx < 20) trend_score = 30;
        else trend_score = 50;
    }


    const fw = getDynamicFilterWeights(regime);
    const scores = {
        price_action: pa_score,
        momentum: momentum_score,
        macro_crypto: macro_score,
        liquidity_spread: liq_score,
        ml_probability: ml_score,
        mtf_alignment: mtf_score,
        volume_liquidity: vol_score,
        funding_onchain: funding_score,
        divergence_penalty: div_score,
        trend_strength: trend_score
    };
    let oiBonus = (oi_score - 50) * 0.08;


    const weights = {
        price_action: fw.price_action || 0.12,
        momentum: fw.momentum || 0.12,
        macro_crypto: fw.macro_crypto || 0.10,
        liquidity_spread: fw.liquidity_spread || 0.08,
        ml_probability: fw.ml_probability || 0.08,
        mtf_alignment: fw.mtf_alignment || 0.10,
        volume_liquidity: fw.volume_liquidity || 0.12,
        funding_onchain: fw.funding_onchain || 0.14,
        divergence_penalty: fw.divergence_penalty || 0.10,
        trend_strength: fw.trend_strength || 0.14
    };
    let finalScore = 0;
    for (const [key, w] of Object.entries(weights)) {
        finalScore += (scores[key] || 50) * w;
    }
    finalScore = Math.min(100, Math.max(0, finalScore + mtfPenalty - clusterPenalty + oiBonus));
    const approve = finalScore >= requiredScore;
    const reasons = [`PA: ${scores.price_action.toFixed(0)}`, `Trend: ${scores.trend_strength.toFixed(0)}`,
        `Mom: ${scores.momentum.toFixed(0)}`, `Vol: ${scores.volume_liquidity.toFixed(0)}`,
        `MTF: ${scores.mtf_alignment.toFixed(0)}`, `OI: ${oi_score.toFixed(0)}`
    ];
    return {
        approved: approve,
        score: finalScore,
        reasons,
        regime,
        required: requiredScore,
        scoreBonus: approve ? (finalScore - 50) * 0.3 : -25,
        scoreComponents: scores,
        support,
        resistance,
        volatilityRegime
    };
}
function predictDirectionV3(data) {
    const rsiScore = data.rsi ? (data.rsi - 50) / 50 : 0;
    const fundingScore = data.fundingRate ? -data.fundingRate * 10000 : 0;
    const mvrvScore = data.mvrv ? (1 - data.mvrv) * 2 : 0;
    const prob = 0.5 + 0.1 * rsiScore + 0.1 * fundingScore + 0.1 * mvrvScore;
    return Math.min(1, Math.max(0, prob));
}
function getDynamicLevels(candles) {
    if (!candles || candles.length < 20) return { support: 58000, resistance: 70000 };
    const slice = candles.slice(-20);
    return { support: Math.min(...slice.map(c => c.low)), resistance: Math.max(...slice.map(c => c.high)) };
}
function getVolumeStats(candles) {
    if (!candles || candles.length < 1) return { volume: 0, avgVolume: 0 };
    const volumes = candles.map(c => c.volume || 0);
    const avg = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    return { volume: volumes[volumes.length - 1] || 0, avgVolume: avg };
}


// ================================================================
// SCORE INSTITUCIONAL (COM ATUALIZAÇÃO DE REGIME EM TEMPO REAL)
// ================================================================
function refreshCurrentRegime(price, candleHistory) {
    const closes = candleHistory.map(c => c.close);
    const ema50 = calculateEMA(closes, 50) || price;
    const ema200 = calculateEMA(closes, 200) || price;
    const ema50Prev = ema50History.length >= 2 ? ema50History[ema50History.length - 2] : ema50;
    const trend = getTrendStrength(candleHistory);
    const regime = detectMarketRegimeFixed(price, ema50, ema50Prev, ema200, trend.adx || 25);
    updateRegimeDisplay(regime);
    currentRegime = regime;
    return regime;
}


function computeScore(data) {
    const hist = alertLog.filter(t => t.win !== null);
    if (hist.length > 20) {
        const comps = ['trend', 'momentum', 'structure', 'onchain', 'volume', 'oi'];
        const stats = {};
        comps.forEach(c => stats[c] = { wins: 0, losses: 0 });
        hist.forEach(t => {
            if (!t.components) return;
            const win = t.win === true;
            Object.keys(t.components).forEach(key => {
                if (stats[key]) {
                    if (win) stats[key].wins++;
                    else stats[key].losses++;
                }
            });
        });
        let total = 0;
        const nw = {};
        comps.forEach(key => {
            const s = stats[key];
            const wr = (s.wins + s.losses > 0) ? s.wins / (s.wins + s.losses) : 0.5;
            nw[key] = wr;
            total += wr;
        });
        if (total > 0) comps.forEach(key => componentWeights[key] = nw[key] / total);
    }


    const regime = currentRegime || 'BULL';
    const dynWeights = getDynamicWeights(regime);
    const weights = { trend: dynWeights.trend, momentum: dynWeights.momentum, structure: dynWeights.structure,
        onchain: dynWeights.onChain, volume: dynWeights.volume, oi: dynWeights.oi };


    const price = data.price || 60000;
    const ema50 = data.ema50 || 65000;
    const ema200 = data.ema200 || 62000;
    const rsi = data.rsi !== undefined ? data.rsi : 45;
    const macd = data.macd || 120;
    const macdSignal = data.macdSignal || 100;
    const roc = data.roc || -2.5;
    const support = data.support || globalData.support || 58000;
    const resistance = data.resistance || globalData.resistance || 70000;
    const fvgZones = data.fvgZones || [{ low: 62000, high: 63500 }];
    const mvrv = data.mvrv || 1.2;
    const sopr = data.sopr || 0.95;
    const volumeRel = data.volumeRel || 1.0;
    const oiDelta = data.oiDelta || 0.0;


    let t = (ema50 > ema200) ? 1 : -1;
    let rsi_norm = clamp((rsi - 30) / 40, 0, 1);
    let macd_diff = macd - macdSignal;
    let macd_norm = clamp((macd_diff / 200) + 0.5, 0, 1);
    let roc_norm = clamp((roc / 100) + 0.5, 0, 1);
    let m = (rsi_norm + macd_norm + roc_norm) / 3;
    let range = resistance - support;
    let se_raw = (price - support) / range;
    let se = 1 - clamp(se_raw, 0, 1);
    let inFvg = fvgZones.some(f => price >= f.low && price <= f.high);
    if (inFvg) se = Math.min(se + 0.2, 1);
    let mvrv_norm = 1 - clamp((mvrv - 1) / 3, 0, 1);
    let sopr_norm = clamp(sopr - 0.5, 0, 1);
    let o = (mvrv_norm + sopr_norm) / 2;
    let vol = clamp((volumeRel - 0.5) * 2, -1, 1);
    vol = (vol + 1) / 2;
    let oi = clamp(oiDelta / 20, -1, 1);
    oi = (oi + 1) / 2;


    let raw = t * weights.trend + m * weights.momentum + se * weights.structure + o * weights.onchain + vol * weights
        .volume + oi * weights.oi;
    raw = clamp((raw + 1) / 2, 0, 1);
    let finalScore = raw * 100;
    if (Math.abs(oiDelta) > 10) {
        finalScore -= 10;
        finalScore = clamp(finalScore, 0, 100);
    }
    const components = {
        trend: (t * 50 + 50).toFixed(1),
        momentum: (m * 50 + 50).toFixed(1),
        structure: (se * 50 + 50).toFixed(1),
        onchain: (o * 50 + 50).toFixed(1),
        volume: (vol * 50 + 50).toFixed(1),
        oi: (oi * 50 + 50).toFixed(1)
    };
    return { score: Math.round(finalScore), components };
}


function updateScoreDisplay(scoreData) {
    const score = scoreData.score;
    const components = scoreData.components;
    const sv = document.getElementById('score-value');
    const sb = document.getElementById('score-bar');
    if (sv) {
        sv.textContent = score;
        if (score >= 75) { sv.style.color = 'var(--accent-green)';
            sb.style.background = 'var(--accent-green)'; } else if (score <= 25) { sv.style.color = 'var(--accent-red)';
            sb.style.background = 'var(--accent-red)'; } else { sv.style.color = 'var(--accent-yellow)';
            sb.style.background = 'var(--accent-yellow)'; }
    }
    if (sb) sb.style.width = score + '%';
    document.getElementById('score-trend').textContent = components.trend;
    document.getElementById('score-momentum').textContent = components.momentum;
    document.getElementById('score-structure').textContent = components.structure;
    document.getElementById('score-onchain').textContent = components.onchain;
    document.getElementById('score-volume').textContent = components.volume;
    document.getElementById('score-oi').textContent = components.oi;


    // Adicionar ao histórico do gráfico
    const now = Date.now();
    scoreHistory.push({ time: now, score: score });
    if (scoreHistory.length > MAX_SCORE_HISTORY) scoreHistory.shift();
    updateScoreChart();


    checkAdditionalAlertsV13(score, components);
    
    // Atualiza painéis dependentes do score
    updateConfirmationPanel();
    updateAnalysisScores();
}


// ================================================================
// GRÁFICO DE SCORE (PLUGIN LOCAL, NÃO GLOBAL)
// ================================================================
const thresholdPlugin = {
    id: 'customThresholdLines',
    beforeDraw: function(chart) {
        const yScale = chart.scales.y;
        if (!yScale) return;
        const ctx = chart.ctx;
        const y25 = yScale.getPixelForValue(25);
        const y75 = yScale.getPixelForValue(75);
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(233,69,96,0.5)';
        ctx.beginPath();
        ctx.moveTo(chart.chartArea.left, y25);
        ctx.lineTo(chart.chartArea.right, y25);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(0,217,142,0.5)';
        ctx.beginPath();
        ctx.moveTo(chart.chartArea.left, y75);
        ctx.lineTo(chart.chartArea.right, y75);
        ctx.stroke();
        ctx.restore();
        ctx.save();
        ctx.fillStyle = 'rgba(233,69,96,0.7)';
        ctx.font = '10px sans-serif';
        ctx.fillText('SHORT (25)', chart.chartArea.right - 80, y25 - 6);
        ctx.fillStyle = 'rgba(0,217,142,0.7)';
        ctx.fillText('LONG (75)', chart.chartArea.right - 80, y75 - 6);
        ctx.restore();
    }
};


function initScoreChart() {
    const canvas = document.getElementById('scoreHistoryChart');
    if (!canvas) return;
    // Plugin é passado apenas para esta instância, não registrado globalmente
    scoreChart = new Chart(canvas, {
        type: 'line',
        data: { datasets: [{ label: 'Score Institucional', data: [], borderColor: '#00b4d8',
                backgroundColor: 'rgba(0,180,216,0.1)', borderWidth: 2, fill: true, tension: 0.3,
                pointRadius: 1, pointHoverRadius: 4 }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(context) {
                            return 'Score: ' + context.parsed.y.toFixed(0);
                        }, title: function(items) { return new Date(items[0].parsed.x).toLocaleString(
                            'pt-BR'); } } } },
            scales: {
                x: { type: 'linear', grid: { color: 'rgba(44,62,80,0.3)' }, ticks: { color: '#95a5a6',
                        callback: function(value) { return new Date(value).toLocaleTimeString('pt-BR',
                            { hour: '2-digit', minute: '2-digit' }); }, maxTicksLimit: 15,
                        autoSkip: true } },
                y: { min: 0, max: 100, grid: { color: 'rgba(44,62,80,0.3)' }, ticks: { color: '#95a5a6' } }
            },
            elements: { line: { tension: 0.3 } }
        },
        plugins: [thresholdPlugin] // plugin local
    });
    updateScoreChart();
}


function updateScoreChart() {
    if (!scoreChart) return;
    const now = Date.now();
    const msMap = { '1h': 3600000, '6h': 21600000, '12h': 43200000, '24h': 86400000, '7d': 604800000 };
    const limit = msMap[currentScoreTimeframe] || 86400000;
    const cutoff = now - limit;
    let filtered = scoreHistory.filter(p => p.time >= cutoff);
    const maxPoints = 500;
    if (filtered.length > maxPoints) {
        const step = Math.ceil(filtered.length / maxPoints);
        filtered = filtered.filter((_, i) => i % step === 0);
    }
    scoreChart.data.datasets[0].data = filtered.map(p => ({ x: p.time, y: p.score }));
    scoreChart.update('none');
}


document.addEventListener('click', function(e) {
    const btn = e.target.closest('#score-tf-buttons .tf-btn');
    if (!btn) return;
    const parent = btn.closest('#score-tf-buttons');
    if (!parent) return;
    parent.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentScoreTimeframe = btn.dataset.tf;
    updateScoreChart();
});


// ================================================================
// NOVAS FUNÇÕES: PAINEL DE CONFIRMAÇÃO E SCORES DE ANÁLISE
// ================================================================
function updateConfirmationPanel() {
    // Pega dados atuais
    const mvrv = globalData.mvrv || 1.2;
    const fearGreedText = document.getElementById('header-fng')?.textContent || '';
    const fearGreedMatch = fearGreedText.match(/\d+/);
    const fearGreed = fearGreedMatch ? parseInt(fearGreedMatch[0]) : 50;
    const sthEl = document.getElementById('mvrv-sth');
    const sth = sthEl ? parseFloat(sthEl.textContent.replace(',', '.')) : 0.84;


    // Atualiza os ícones
    document.getElementById('p-mvrv').textContent = mvrv < 0.85 ? '✅' : '❌';
    document.getElementById('p-fear').textContent = fearGreed <= 25 ? '✅' : '❌';
    document.getElementById('p-sth').textContent = sth < 1.0 ? '✅' : '❌';
    document.getElementById('p-smart').textContent = currentWhaleState === 'accumulating' ? '✅' : '❌';
    // Macro permanece como referência (não alterado)
}


function updateAnalysisScores() {
    const score = parseInt(document.getElementById('score-value')?.textContent) || 50;
    const rsi = globalData.rsi || 50;


    // Risk Score: quanto maior o score, menor o risco
    const risk = Math.min(100, Math.max(0, 100 - score));
    // Confidence: igual ao score
    const confidence = score;
    // Entry Score: score + bônus se alinhado com RSI
    let entry = score;
    if (score > 75 && rsi < 70) entry = Math.min(100, entry + 10);
    else if (score < 25 && rsi > 30) entry = Math.min(100, entry + 10);
    // Exit Score: baseado no RSI (quanto maior o RSI, maior tendência de saída)
    let exit = 50;
    if (rsi > 70) exit = 80;
    else if (rsi < 30) exit = 20;
    else exit = 50 + (rsi - 50) * 0.5;
    exit = Math.min(100, Math.max(0, exit));


    // Seleciona os elementos de score (ordem: Risk, Confidence, Entry, Exit)
    const scoreValues = document.querySelectorAll('.score-box .score-value');
    if (scoreValues.length >= 4) {
        scoreValues[0].textContent = risk + '/100';
        scoreValues[1].textContent = confidence + '/100';
        scoreValues[2].textContent = entry + '/100';
        scoreValues[3].textContent = exit + '/100';
        // Ajusta cores (opcional)
        const colors = [
            risk > 70 ? 'var(--accent-red)' : 'var(--accent-yellow)',
            confidence > 70 ? 'var(--accent-green)' : 'var(--accent-yellow)',
            entry > 70 ? 'var(--accent-green)' : 'var(--accent-yellow)',
            exit > 70 ? 'var(--accent-red)' : 'var(--accent-yellow)'
        ];
        scoreValues.forEach((el, idx) => el.style.color = colors[idx]);
    }
}


// ================================================================
// ALERTA EM TEMPO REAL (CORRIGIDO: REGIME ATUALIZADO ANTES DO GATE)
// ================================================================
async function checkAdditionalAlertsV13(score, components) {
    const now = Date.now();
    if (now - lastAlertTime < ALERT_COOLDOWN) return;
    const price = parseFloat(document.getElementById('btc-price').textContent.replace(/[$,]/g, '')) || 60000;
    const fundingRateEl = document.getElementById('funding-rate');
    const fundingRate = fundingRateEl ? parseFloat(fundingRateEl.textContent.replace('%', '')) / 100 : 0;
    const mvrvEl = document.getElementById('mvrv');
    const mvrv = mvrvEl ? parseFloat(mvrvEl.textContent) : 1.2;
    const soprEl = document.getElementById('sopr');
    const sopr = soprEl ? parseFloat(soprEl.textContent) : 0.95;
    let data = {
        price, rsi: 50, macd: 0, macdSignal: 0, volumeRatio: 1, fundingRate, mvrv, sopr,
        support: 58000, resistance: 70000, atr: price * 0.02,
        oiDelta: globalData.oiDelta || 0, volume: 0, avgVolume: 0,
        minerOutflow: 500, positionSize: 0.01, adx: 25
    };
    // --- CORREÇÃO: atualiza o regime ANTES de qualquer decisão de sinal ---
    refreshCurrentRegime(price, candleHistory);
    const regimeLive = currentRegime;


    // Sinal: prioriza regime-aware, fallback para score
    const regSignalLive = getRegimeAwareSignal(data, regimeLive);
    let signal = null;
    if (regSignalLive !== 'NEUTRAL') {
        signal = regSignalLive;
    } else {
        if (score >= 75) signal = 'LONG';
        else if (score <= 25) signal = 'SHORT';
    }
    if (!signal) return;


    const mtfData = await fetchMTFData('BTCUSDT');
    const candles = candleHistory.length > 0 ? candleHistory : [];
    const rsiVals = rsiHistory.length > 0 ? rsiHistory : [];
    const macdVals = macdHistory.length > 0 ? macdHistory : [];
    const obvVals = obvHistory.length > 0 ? obvHistory : [];


    const dynamic = getDynamicLevels(candles);
    const volStats = getVolumeStats(candles);
    data.support = dynamic.support;
    data.resistance = dynamic.resistance;
    data.volume = volStats.volume;
    data.avgVolume = volStats.avgVolume;
    const atr = calculateATR(candles.map(c => c.close)) || price * 0.02;
    data.atr = atr;
    const trend = getTrendStrength(candles);
    data.adx = trend.adx || 25;
    globalData.support = data.support;
    globalData.resistance = data.resistance;


    const closesLive = candles.map(c => c.close);
    const ema50Live = calculateEMA(closesLive, 50) || price;
    const ema50PrevLive = ema50History.length >= 2 ? ema50History[ema50History.length - 2] : ema50Live;
    data.ema50Prev = ema50PrevLive;
    data.priceDeltaPct = closesLive.length > 1 ? (price - closesLive[closesLive.length - 2]) / closesLive[closesLive
        .length - 2] * 100 : 0;


    const side = signal === 'LONG' ? 'BUY' : 'SELL';
    const cluster = await checkClusterOrders('BTCUSDT', data.price, side);


    const conf = await confirmSignalV13(signal, data, candles, rsiVals, macdVals, obvVals, mtfData, false, cluster);
    if (!conf.approved) {
        console.log(`Sinal bloqueado: score ${conf.score.toFixed(0)}/100 (requerido ≥${conf.required})`);
        return;
    }


    // Aplica a confluência de baleias ao tamanho da posição (corrigido)
    const whaleMult = getWhaleConfluenceMultiplier(signal, currentWhaleState);


    tradeHistory.push({ outcome: false, features: conf.scoreComponents || {} });
    tradeCounter++;
    if (tradeCounter % OPTIMIZATION_INTERVAL === 0) updateFilterWeightsV6();


    const regime = conf.regime || 'NEUTRO';
    const stopPrice = getStopLossV8(regime, atr, price, signal, conf.support, conf.resistance);
    const stop = Math.max(stopPrice, 0);
    let targets = generateScaledTargetsV8(price, stop, signal, conf.volatilityRegime || 'NORMAL', regime);
    let finalScore = score + conf.scoreBonus;
    finalScore = Math.min(100, Math.max(0, finalScore));
    // Aplica o multiplicador de baleia ao tamanho sugerido na mensagem
    const adjustedSize = whaleMult;
    const rationale =
        `Filtros V13: ${conf.score.toFixed(0)}/100 score. Regime: ${regime}. Vol: ${conf.volatilityRegime}. Whale confluence: ${whaleMult.toFixed(2)}x. MTF: ${conf.reasons[4]}`;
    await sendStructuredAlert(signal, finalScore, price, stop, targets, rationale, components);
    lastAlertTime = now;
}


// ================================================================
// BACKTEST V13 (CORRIGIDO: RSI/MACD PROGRESSIVOS, FUNDING HISTÓRICO)
// ================================================================
async function fetchOnChainSeriesForBacktest(candles4h) {
    if (!candles4h || candles4h.length < 2) return new Map();
    const startDay = Math.floor(candles4h[0].time / 86400) * 86400;
    const endDay = Math.floor(candles4h[candles4h.length - 1].time / 86400) * 86400;
    const map = new Map();
    try {
        const [mvrvRes, soprRes] = await Promise.all([
            fetch(`https://bitview.space/api/metrics/btc/mvrv?resolution=1d&from=${startDay}&to=${endDay}`),
            fetch(`https://bitview.space/api/metrics/btc/sopr?resolution=1d&from=${startDay}&to=${endDay}`)
        ]);
        const mvrvData = mvrvRes.ok ? await mvrvRes.json() : [];
        const soprData = soprRes.ok ? await soprRes.json() : [];
        mvrvData.forEach(([t, v]) => {
            const day = Math.floor(t / 86400) * 86400;
            if (!map.has(day)) map.set(day, {});
            map.get(day).mvrv = v;
        });
        soprData.forEach(([t, v]) => {
            const day = Math.floor(t / 86400) * 86400;
            if (!map.has(day)) map.set(day, {});
            map.get(day).sopr = v;
        });
    } catch (e) { console.warn('On-chain histórico indisponível, usando fallback neutro (1.0/1.0)'); }
    return map;
}


// Função auxiliar para construir séries progressivas de RSI/MACD (corrige bug de índice)
function buildIndicatorSeries(closes) {
    const rsiSlice = closes.map((_, idx) => calculateRSI(closes.slice(0, idx + 1)));
    const macdSlice = closes.map((_, idx) => calculateMACD(closes.slice(0, idx + 1)) || 0);
    return { rsiSlice, macdSlice };
}


let backtestRunning = false;
async function runBacktest() {
    const container = document.getElementById('backtestResults');
    const btn = document.getElementById('runBacktestBtn');
    if (backtestRunning) return;
    backtestRunning = true;
    btn.disabled = true;
    btn.textContent = '⏳ Carregando...';
    container.innerHTML = '<div class="backtest-loading"><div class="spinner"></div><p>Carregando dados 4h + on-chain...</p></div>';


    const periodSelect = document.getElementById('backtestPeriod');
    const days = parseInt(periodSelect ? periodSelect.value : 90);
    const limit = Math.floor(days * 6);


    try {
        const fetchWithTimeout = (url, timeout = 30000) => Promise.race([fetch(url), new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), timeout))]);
        const now = Date.now(),
            startTime = now - days * 24 * 60 * 60 * 1000;
        let klines;
        try {
            const r = await fetchWithTimeout(
                `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=4h&startTime=${startTime}&limit=${limit}`,
                30000);
            if (r.ok) klines = await r.json();
            else throw new Error('HTTP ' + r.status);
        } catch (e) { console.warn('Falha dados 4h, usando simulados.', e);
            klines = gerarDadosSimulados(limit); }
        if (!klines || klines.length < 20) klines = gerarDadosSimulados(limit);
        function gerarDadosSimulados(num) {
            const dados = [];
            let preco = 60000;
            const agora = Date.now();
            for (let i = num; i >= 0; i--) {
                const variacao = (Math.random() - 0.5) * 0.02;
                preco = preco * (1 + variacao);
                const data = new Date(agora - i * 4 * 60 * 60 * 1000);
                const open = preco * (1 + (Math.random() - 0.5) * 0.005);
                const high = Math.max(open, preco) * (1 + Math.random() * 0.01);
                const low = Math.min(open, preco) * (1 - Math.random() * 0.01);
                dados.push([data.getTime(), open.toFixed(2), high.toFixed(2), low.toFixed(2), preco.toFixed(2), (Math
                    .random() * 200 + 100).toFixed(0)]);
            }
            return dados;
        }
        const dataset = klines.map(k => ({
            date: new Date(k[0]).toISOString().replace('T', ' ').slice(0, 16),
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5]),
            time: k[0] / 1000
        })).filter(d => d.close > 0);
        if (dataset.length < 20) {
            container.innerHTML =
                `<div class="no-trades"><p>⚠️ Dados insuficientes (${dataset.length} candles 4h).</p></div>`;
            backtestRunning = false;
            btn.disabled = false;
            btn.textContent = '▶ Executar Backtest V13';
            return;
        }
        console.log(`📥 Buscando on-chain histórico para ${days} dias...`);
        const onChainMap = await fetchOnChainSeriesForBacktest(dataset);
        console.log(`✅ On-chain carregado: ${onChainMap.size} dias`);


        // Buscar funding histórico (corrige #4)
        console.log('📥 Buscando funding histórico...');
        const fundingMap = new Map();
        try {
            const r = await fetchWithTimeout(
                `https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&startTime=${startTime}&endTime=${now}&limit=1000`,
                10000);
            if (r.ok) {
                const data = await r.json();
                data.forEach(item => { fundingMap.set(item.fundingTime, parseFloat(item.fundingRate)); });
                console.log(`✅ Funding histórico carregado: ${fundingMap.size} registros`);
            }
        } catch (e) { console.warn('Funding histórico indisponível, filtro ficará neutro:', e); }


        function getFundingAtTime(fundingMap, candleTimeMs) {
            let closest = 0;
            for (const [ts, rate] of fundingMap) {
                if (ts <= candleTimeMs) closest = rate;
                else break;
            }
            return closest;
        }


        const initialCapital = 10000;
        let balance = initialCapital,
            peak = balance,
            maxDrawdown = 0,
            trades = [],
            position = null,
            rejectedCount = 0,
            reasons = {};
        const FEE = 0.001,
            SLIPPAGE = 0.0005;


        function calcATR(data, period = 14) {
            const tr = [];
            for (let i = 1; i < data.length; i++) {
                const high = data[i].high,
                    low = data[i].low,
                    pc = data[i - 1].close;
                tr.push(Math.max(high - low, Math.abs(high - pc), Math.abs(low - pc)));
            }
            if (tr.length < period) return 0;
            let atr = tr.slice(0, period).reduce((a, b) => a + b) / period;
            for (let i = period; i < tr.length; i++) atr = (atr * (period - 1) + tr[i]) / period;
            return atr;
        }
        const atrValues = [];
        for (let i = 0; i < dataset.length; i++) {
            const slice = dataset.slice(Math.max(0, i - 14), i + 1);
            atrValues.push(calcATR(slice, 14));
        }


        for (let i = 20; i < dataset.length; i++) {
            const candle = dataset[i],
                price = candle.close,
                atr = atrValues[i] || price * 0.02;
            const closes = dataset.slice(0, i + 1).map(d => d.close);
            const ema50 = calculateEMA(closes, 50) || price;
            const ema200 = calculateEMA(closes, 200) || price;
            const closesPrev = dataset.slice(0, i).map(d => d.close);
            const ema50Prev = calculateEMA(closesPrev, 50) || ema50;
            const rsi = calculateRSI(closes, 14) || 50;
            const macdVal = calculateMACD(closes) || 0;
            const obvVal = calculateOBV(dataset.slice(0, i + 1));


            // --- CORREÇÃO #3: séries progressivas de RSI/MACD ---
            const { rsiSlice, macdSlice } = buildIndicatorSeries(closes);
            const obvSlice = dataset.slice(0, i + 1).map((_, idx) => calculateOBV(dataset.slice(0, idx + 1)));


            // --- CORREÇÃO #4: funding histórico real ---
            const fundingRate = getFundingAtTime(fundingMap, dataset[i].time * 1000);


            const simData = {
                price: price,
                ema50: ema50,
                ema200: ema200,
                rsi: rsi,
                macd: macdVal,
                macdSignal: 0,
                roc: closes.length > 10 ? ((price - closes[closes.length - 11]) / closes[closes.length - 11]) * 100 : 0,
                support: Math.min(...dataset.slice(Math.max(0, i - 20), i + 1).map(d => d.low)),
                resistance: Math.max(...dataset.slice(Math.max(0, i - 20), i + 1).map(d => d.high)),
                mvrv: 1.2,
                sopr: 0.95,
                volumeRel: candle.volume / (dataset.slice(Math.max(0, i - 20), i).reduce((s, d) => s + d.volume, 0) /
                    Math.min(i, 20) || 1),
                oiDelta: 0,
                fvgZones: [{ low: Math.min(...dataset.slice(Math.max(0, i - 20), i + 1).map(d => d.low)), high: Math
                        .max(...dataset.slice(Math.max(0, i - 20), i + 1).map(d => d.high))
                    }],
                ema50Prev: ema50Prev,
                fundingRate: fundingRate // agora real
            };
            const candleDay = Math.floor(new Date(dataset[i].date).getTime() / 1000 / 86400) * 86400;
            const oc = onChainMap.get(candleDay) || { mvrv: 1.0, sopr: 1.0 };
            simData.mvrv = oc.mvrv;
            simData.sopr = oc.sopr;


            const trend = getTrendStrength(dataset.slice(0, i + 1));
            const adx = trend.adx || 25;
            const regimeNow = detectMarketRegimeFixed(price, ema50, ema50Prev, ema200, adx);
            currentRegime = regimeNow;


            const scoreData = computeScore(simData);
            let signal = 'NEUTRAL';
            const regSignal = getRegimeAwareSignal(simData, regimeNow);
            if (regSignal !== 'NEUTRAL') {
                signal = regSignal;
            } else {
                if (scoreData.score >= 75) signal = 'LONG';
                else if (scoreData.score <= 25) signal = 'SHORT';
            }


            const fullData = {
                price,
                rsi,
                macd: macdVal,
                macdSignal: 0,
                volumeRatio: simData.volumeRel,
                fundingRate: fundingRate,
                mvrv: oc.mvrv,
                sopr: oc.sopr,
                oiDelta: 0,
                volume: candle.volume,
                avgVolume: dataset.slice(Math.max(0, i - 20), i).reduce((s, d) => s + d.volume, 0) / Math.min(i, 20) || 1,
                minerOutflow: 500,
                positionSize: 0.01,
                atr: atr,
                adx: adx,
                support: simData.support,
                resistance: simData.resistance,
                ema50Prev: ema50Prev,
                priceDeltaPct: i > 0 ? (price - dataset[i - 1].close) / dataset[i - 1].close * 100 : 0
            };


            const mtfDataPoint = buildHistoricalMTF(dataset, i);
            const clusterData = { cluster: false, volume: 0 };


            const conf = await confirmSignalV13(signal, fullData, dataset.slice(0, i + 1), rsiSlice, macdSlice, obvSlice,
                mtfDataPoint, true, clusterData);
            if (!conf.approved) {
                rejectedCount++;
                const r = conf.reasons[0] || 'Desconhecido';
                reasons[r] = (reasons[r] || 0) + 1;
                signal = 'NEUTRAL';
            }
            const regime = conf.regime || 'NEUTRO';


            if (position === null && signal !== 'NEUTRAL') {
                const stopPrice = getStopLossV8(regime, atr, price, signal, conf.support, conf.resistance);
                const entry = price * (1 + (signal === 'LONG' ? SLIPPAGE : -SLIPPAGE));
                const risk = Math.abs(entry - stopPrice);
                CAPITAL = balance;
                const kellyPct = calculateKellySizingByRegime(regime);
                const riskAmount = balance * kellyPct;
                const size = riskAmount / risk;
                let targets = generateScaledTargetsV8(entry, stopPrice, signal, conf.volatilityRegime || 'NORMAL',
                regime);
                const fvgZones = [{ low: fullData.support, high: fullData.resistance }];
                position = {
                    side: signal,
                    entryPrice: entry,
                    stop: stopPrice,
                    targets: targets,
                    size: size,
                    entryIndex: i,
                    highestPrice: entry,
                    lowestPrice: entry,
                    tpHit: [false, false, false],
                    breakeven: false,
                    breakeven_stop: null,
                    initialATR: atr,
                    regime: regime,
                    remainingSize: size,
                    fvgZones: fvgZones,
                    tp1Hit: false,
                    tp2Hit: false
                };
            } else if (position !== null) {
                const high = candle.high,
                    low = candle.low;
                let exitPrice = null,
                    exitReason = '',
                    exitSize = 0;
                if (position.side === 'LONG') { if (high > position.highestPrice) position.highestPrice = high; } else { if (
                        low < position.lowestPrice) position.lowestPrice = low; }
                const newStop = updateTrailingStopV8(regime, position, price, atr, conf.support, conf.resistance);
                position.stop = newStop;
                for (let idx = 0; idx < position.targets.length; idx++) {
                    if (!position.tpHit[idx] && position.remainingSize > 0) {
                        const tp = position.targets[idx];
                        let hit = false;
                        if (position.side === 'LONG' && high >= tp.price) { hit = true;
                            exitPrice = tp.price * (1 - SLIPPAGE); } else if (position.side === 'SHORT' && low <= tp
                            .price) { hit = true;
                            exitPrice = tp.price * (1 + SLIPPAGE); }
                        if (hit) {
                            const sizeToClose = position.remainingSize * tp.size;
                            exitSize = sizeToClose;
                            exitReason = `${tp.label} (parcial)`;
                            position.tpHit[idx] = true;
                            position.remainingSize -= sizeToClose;
                            if (idx === 0) { updateBreakevenStopV8(position, 'TP1', atr, regime);
                                position.tp1Hit = true; }
                            if (idx === 1) position.tp2Hit = true;
                            break;
                        }
                    }
                }
                if (exitPrice === null && position.remainingSize > 0) {
                    if (position.side === 'LONG' && low <= position.stop) { exitPrice = position.stop * (1 - SLIPPAGE);
                        exitReason = 'Stop Loss';
                        exitSize = position.remainingSize; } else if (position.side === 'SHORT' && high >= position.stop) {
                        exitPrice = position.stop * (1 + SLIPPAGE);
                        exitReason = 'Stop Loss';
                        exitSize = position.remainingSize; }
                }
                if (exitPrice === null && position.remainingSize > 0) {
                    const currentSignal = signal;
                    if ((position.side === 'LONG' && (currentSignal === 'SHORT' || currentSignal === 'NEUTRAL')) ||
                        (position.side === 'SHORT' && (currentSignal === 'LONG' || currentSignal === 'NEUTRAL'))) {
                        exitPrice = price * (1 + (position.side === 'LONG' ? -SLIPPAGE : SLIPPAGE));
                        exitReason = 'Reversão';
                        exitSize = position.remainingSize;
                    }
                }
                if (exitPrice === null && i === dataset.length - 1 && position.remainingSize > 0) {
                    exitPrice = price * (1 + (position.side === 'LONG' ? -SLIPPAGE : SLIPPAGE));
                    exitReason = 'Fim';
                    exitSize = position.remainingSize;
                }
                if (exitPrice !== null && exitSize > 0) {
                    const pnl = (position.side === 'LONG') ? (exitPrice - position.entryPrice) : (position.entryPrice -
                        exitPrice);
                    const pnlPct = (pnl / position.entryPrice) * 100;
                    const pnlUsd = pnl * exitSize * (1 - FEE);
                    balance += pnlUsd;
                    trades.push({
                        entryDate: dataset[position.entryIndex].date,
                        exitDate: candle.date,
                        type: position.side,
                        entryPrice: position.entryPrice,
                        exitPrice: exitPrice,
                        pnlPct: pnlPct,
                        pnlUsd: pnlUsd,
                        exitReason: exitReason,
                        size: exitSize,
                        daysOpen: (i - position.entryIndex) / 6,
                        regime: position.regime,
                        confScore: conf.score || 50,
                        scoreComponents: conf.scoreComponents || {}
                    });
                    if (trades.length > 0) {
                        const last = trades[trades.length - 1];
                        tradeHistory.push({ outcome: last.pnlUsd > 0, features: last.scoreComponents || {} });
                        if (tradeHistory.length % OPTIMIZATION_INTERVAL === 0) updateFilterWeightsV6();
                    }
                    if (balance > peak) peak = balance;
                    const dd = (peak - balance) / peak;
                    if (dd > maxDrawdown) maxDrawdown = dd;
                    position.remainingSize -= exitSize;
                    if (position.remainingSize <= 0) position = null;
                }
            }
        }
        console.log(`📊 Backtest concluído. Trades: ${trades.length}, Rejeitados: ${rejectedCount}`);
        console.log('Motivos de rejeição:', reasons);


        const totalTrades = trades.length,
            wins = trades.filter(t => t.pnlUsd > 0).length,
            losses = trades.filter(t => t.pnlUsd < 0).length,
            winRate = totalTrades ? (wins / totalTrades) * 100 : 0,
            totalReturn = ((balance - initialCapital) / initialCapital) * 100,
            profitFactor = losses ? trades.filter(t => t.pnlUsd > 0).reduce((s, t) => s + t.pnlUsd, 0) / Math.abs(trades
                .filter(t => t.pnlUsd < 0).reduce((s, t) => s + t.pnlUsd, 0)) : (wins ? Infinity : 0);


        function assessSignificance(N, wr) {
            if (N < 30) return { sufficient: false, margin: null, warning: `Apenas ${N} trades — amostra insuficiente. Mínimo 30.` };
            const p = wr / 100;
            const margin = 1.96 * Math.sqrt((p * (1 - p)) / N) * 100;
            return { sufficient: true, margin: margin, warning: margin > 10 ? `Margem de erro ±${margin.toFixed(1)}pp — amplie janela.` : null };
        }
        const sig = assessSignificance(totalTrades, winRate);


        let html =
            `<div class="backtest-stats-grid"><div class="backtest-stat-card"><div class="stat-value ${winRate>=60?'positive':winRate<40?'negative':'neutral'}">${winRate.toFixed(1)}%</div><div class="stat-label">Win Rate</div></div><div class="backtest-stat-card"><div class="stat-value ${totalReturn>=0?'positive':'negative'}">${totalReturn.toFixed(2)}%</div><div class="stat-label">Retorno Total</div></div><div class="backtest-stat-card"><div class="stat-value ${balance>=initialCapital?'positive':'negative'}">$${balance.toFixed(2)}</div><div class="stat-label">Saldo Final</div></div><div class="backtest-stat-card"><div class="stat-value">${totalTrades}</div><div class="stat-label">Total Trades</div></div><div class="backtest-stat-card"><div class="stat-value ${profitFactor>=1.5?'positive':'neutral'}">${profitFactor===Infinity?'∞':profitFactor.toFixed(2)}</div><div class="stat-label">Profit Factor</div></div><div class="backtest-stat-card"><div class="stat-value">${wins} / ${losses}</div><div class="stat-label">Wins / Losses</div></div><div class="backtest-stat-card"><div class="stat-value ${maxDrawdown<.1?'positive':'negative'}">${(maxDrawdown*100).toFixed(1)}%</div><div class="stat-label">Max Drawdown</div></div><div class="backtest-stat-card"><div class="stat-value">${trades.filter(t=>t.exitReason.includes('Stop')).length}</div><div class="stat-label">Stops</div></div><div class="backtest-stat-card"><div class="stat-value">${trades.filter(t=>t.exitReason.includes('TP1')).length}</div><div class="stat-label">TP1</div></div><div class="backtest-stat-card"><div class="stat-value">${trades.filter(t=>t.exitReason.includes('TP2')).length}</div><div class="stat-label">TP2</div></div><div class="backtest-stat-card"><div class="stat-value">${trades.filter(t=>t.exitReason.includes('TP3')).length}</div><div class="stat-label">TP3</div></div></div>`;
        if (sig.warning) {
            html += `<div class="no-trades" style="color:var(--accent-yellow);margin:10px 0;">⚠️ ${sig.warning}</div>`;
        }
        if (!trades.length) html +=
        '<div class="no-trades"><p>Nenhum trade gerado no período (4h).</p></div>';
        else {
            html +=
                `<h4 style="color:var(--text-light);margin:20px 0 10px 0;">📋 Histórico de Trades V13</h4><div class="backtest-table-wrap"><table><thead><tr><th>Entrada</th><th>Saída</th><th>Tipo</th><th>Preço Entrada</th><th>Preço Saída</th><th>PnL %</th><th>Dias</th><th>Motivo</th><th>Regime</th><th>Confirmação</th></tr></thead><tbody>${trades.slice().reverse().map(t=>`<tr class="${t.pnlUsd>0?'row-win':'row-loss'}"><td>${t.entryDate}</td><td>${t.exitDate}</td><td>${t.type}</td><td>$${t.entryPrice.toFixed(0)}</td><td>$${t.exitPrice.toFixed(0)}</td><td style="color:${t.pnlUsd>0?'var(--accent-green)':'var(--accent-red)'}">${t.pnlPct.toFixed(2)}%</td><td>${t.daysOpen.toFixed(1)}</td><td>${t.exitReason}</td><td>${t.regime||'N/A'}</td><td>${t.confScore?t.confScore.toFixed(0):'N/A'}</td></tr>`).join('')}</tbody></table></div>`;
        }
        html +=
            `<p style="color:var(--text-muted);font-size:.85em;margin-top:12px;">Período: ${dataset[0]?.date} — ${dataset[dataset.length-1]?.date} (${dataset.length} candles 4h) • ${days} dias • On-chain real • Funding histórico real • RSI/MACD progressivos • Regime-aware • BOS/CHoCH • Funding z-score • OI direcional.</p>`;
        container.innerHTML = html;
    } catch (err) {
        console.error('Backtest error:', err);
        container.innerHTML = `<div class="no-trades"><p>❌ Erro: ${err.message}</p></div>`;
    }
    backtestRunning = false;
    btn.disabled = false;
    btn.textContent = '▶ Executar Backtest V13';
}


// ================================================================
// GRÁFICOS CHART.JS (MANTIDOS)
// ================================================================
window.charts = [];
function destroyAllCharts() { window.charts.forEach(c => { if (c) c.destroy() });
    window.charts = []; }
const chartColors = { primary: 'rgb(0,180,216)', secondary: 'rgb(233,69,96)', success: 'rgb(0,217,142)',
    warning: 'rgb(255,214,10)', text: 'rgb(236,240,241)', border: 'rgb(44,62,80)' };
destroyAllCharts();
const ctx1 = document.getElementById('chart_etf_flows').getContext('2d');
window.charts.push(new Chart(ctx1, { type: 'bar', data: { labels: ['22 JUN', '23 JUN', '24 JUN', '25 JUN', '26 JUN',
            '27 JUN', '28 JUN'], datasets: [{ label: 'BTC ETF Flow (ref)', data: [-120, -85, -155, -92, -138, -165,
                -445
            ], backgroundColor: 'rgba(233,69,96,0.6)', borderColor: 'rgb(233,69,96)', borderWidth: 2 },
        { label: 'ETH ETF Flow (ref)', data: [-8, -12, -15, -10, -18, -20, -12.85],
            backgroundColor: 'rgba(0,180,216,0.4)', borderColor: 'rgb(0,180,216)', borderWidth: 2 }
        ] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true,
                labels: { color: chartColors.text } }, title: { display: true, text: 'ETF Flows (referência)',
                color: chartColors.text } }, scales: { y: { ticks: { color: chartColors.text },
                grid: { color: chartColors.border } }, x: { ticks: { color: chartColors.text },
                grid: { color: chartColors.border } } } } }));
const ctx2 = document.getElementById('chart_macro_rates').getContext('2d');
window.charts.push(new Chart(ctx2, { type: 'line', data: { labels: ['17 JUN', '19 JUN', '21 JUN', '23 JUN', '25 JUN',
            '27 JUN', '28 JUN'], datasets: [{ label: 'DXY (ref)', data: [100.8, 100.95, 101.15, 101.28, 101.32,
                101.35, 101.37
            ], borderColor: 'rgb(233,69,96)', borderWidth: 2, tension: 0.4, yAxisID: 'y' },
        { label: 'US10Y (ref)', data: [4.32, 4.30, 4.29, 4.28, 4.27, 4.28, 4.28],
            borderColor: 'rgb(255,214,10)', borderWidth: 2, tension: 0.4, yAxisID: 'y1' }
        ] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true,
                labels: { color: chartColors.text } }, title: { display: true, text: 'Macro (referência)',
                color: chartColors.text } }, scales: { y: { position: 'left', ticks: { color: chartColors.text },
                grid: { color: chartColors.border } }, y1: { position: 'right', ticks: { color: chartColors
                        .text }, grid: { drawOnChartArea: false } },
            x: { ticks: { color: chartColors.text }, grid: { color: chartColors.border } } } } }));
const ctx3 = document.getElementById('chart_scenarios').getContext('2d');
window.charts.push(new Chart(ctx3, { type: 'doughnut', data: { labels: ['Bounce Tático', 'Markdown Estendido',
            'Reversal Estrutural'
        ], datasets: [{ data: [35, 45, 20], backgroundColor: ['rgba(255,214,10,0.6)',
                'rgba(233,69,96,0.6)', 'rgba(0,217,142,0.6)'
            ] }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: chartColors
                    .text } } } } }));
const ctx4 = document.getElementById('chart_allocation').getContext('2d');
window.charts.push(new Chart(ctx4, { type: 'pie', data: { labels: ['BTC (25%)', 'ETH (10%)', 'Stablecoins (65%)'],
        datasets: [{ data: [25, 10, 65], backgroundColor: ['rgba(0,180,216,0.6)', 'rgba(255,214,10,0.6)',
                'rgba(0,217,142,0.6)'
            ] }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom',
                labels: { color: chartColors.text } } } } }));
let whaleFlowChart = null;
function initWhaleFlowChart() {
    const ctx = document.getElementById('chart_whale_flow').getContext('2d');
    whaleFlowChart = new Chart(ctx, { type: 'bar', data: { labels: ['BTC', 'ETH'], datasets: [{ label: 'Acumulação (ref)',
                data: [700, 0], backgroundColor: 'rgba(0,217,142,0.7)', borderColor: 'rgb(0,217,142)',
                borderWidth: 2 }, { label: 'Distribuição (ref)', data: [0, 27.4],
                backgroundColor: 'rgba(233,69,96,0.7)', borderColor: 'rgb(233,69,96)', borderWidth: 2 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true,
                labels: { color: chartColors.text } }, title: { display: true, text: 'Fluxo de Baleias (referência)',
                color: chartColors.text } }, scales: { y: { ticks: { color: chartColors.text },
                grid: { color: chartColors.border }, title: { display: true, text: 'Volume (USD M)',
                    color: chartColors.text } }, x: { ticks: { color: chartColors.text },
                grid: { color: chartColors.border } } } } });
    window.charts.push(whaleFlowChart);
}


// ================================================================
// CANDLESTICK WEBSOCKETS (COM RECONEXÃO AUTOMÁTICA)
// ================================================================
function updateTimestamp() {
    const ts = getCurrentTimestamp();
    document.getElementById('header-timestamp').textContent = '📅 ' + ts + ' UTC-3';
    document.getElementById('last-update').textContent = ts;
    updateAllSourceTimestamps();
}
function updateLiveTime() {
    const ts = getCurrentTimestamp();
    document.getElementById('live-update-time').textContent = ts;
    document.getElementById('status-badge').textContent = '✅ LIVE';
    document.getElementById('status-badge').className = 'status-badge live';
}
function updateAllSourceTimestamps() {
    document.querySelectorAll('.data-source').forEach(el => {
        const c = el.textContent;
        if (!c.includes('•')) el.textContent = c + ' • ' + getCurrentTimestamp();
        else el.textContent = c.replace(/•.*$/, '• ' + getCurrentTimestamp());
    });
}
function updateSourceTimestamp(elId) {
    const el = document.getElementById(elId);
    if (el) {
        const c = el.textContent;
        if (!c.includes('•')) el.textContent = c + ' • ' + getCurrentTimestamp();
        else el.textContent = c.replace(/•.*$/, '• ' + getCurrentTimestamp());
    }
}
let candleCharts = {};


function initCandleChart(containerId, symbol, color) {
    const container = document.getElementById(containerId);
    if (!container) return null;
    const chart = LightweightCharts.createChart(container, { width: container.clientWidth, height: 250,
        layout: { background: { color: '#1a1a2e' }, textColor: '#95a5a6' },
        grid: { vertLines: { visible: false }, horzLines: { visible: false } },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal }, priceScale: { borderColor: '#2c3e50' },
        timeScale: { borderColor: '#2c3e50', timeVisible: true, secondsVisible: false } });
    const candleSeries = chart.addCandlestickSeries({ upColor: color || '#00d98e', downColor: '#e94560',
        borderDownColor: '#e94560', borderUpColor: '#00d98e', wickDownColor: '#e94560', wickUpColor: '#00d98e' });
    return { chart, candleSeries, symbol };
}
async function fetchCandles(symbol, interval = '1h', limit = 50) {
    try {
        const r = await fetch(
            `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
        if (!r.ok) throw new Error('Binance API error: ' + r.status);
        const data = await r.json();
        return data.map(k => ({ time: k[0] / 1000, open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]),
            close: parseFloat(k[4]) }));
    } catch (e) { console.warn(`Candles ${symbol} error:`, e); return null; }
}
async function updateCandleChart(containerId, symbol, interval) {
    const chartObj = candleCharts[containerId];
    if (!chartObj) return;
    const data = await fetchCandles(symbol, interval, 60);
    if (data && data.length > 0) {
        chartObj.candleSeries.setData(data);
        chartObj.chart.timeScale().fitContent();
        const labelId = containerId.replace('candle-', '') + '-tf-label';
        const label = document.getElementById(labelId);
        if (label) label.textContent = interval;
    }
}
async function initCandles() {
    const pairs = [{ id: 'candle-btc', symbol: 'BTCUSDT', color: '#00d98e' }, { id: 'candle-eth', symbol: 'ETHUSDT',
            color: '#00b4d8' }, { id: 'candle-sol', symbol: 'SOLUSDT', color: '#ffd60a' }];
    for (const p of pairs) {
        const chartObj = initCandleChart(p.id, p.symbol, p.color);
        if (chartObj) { candleCharts[p.id] = chartObj;
            await updateCandleChart(p.id, p.symbol, '1h'); }
    }
    await updateDailyStats();
}
async function updateDailyStats() {
    const pairs = [{ id: 'btc-stats', symbol: 'BTCUSDT' }, { id: 'eth-stats', symbol: 'ETHUSDT' }, { id: 'sol-stats',
            symbol: 'SOLUSDT' }];
    for (const p of pairs) {
        try {
            const r = await fetch(
                `https://api.binance.com/api/v3/klines?symbol=${p.symbol}&interval=1d&limit=31`);
            if (!r.ok) continue;
            const data = await r.json();
            const closes = data.map(k => parseFloat(k[4]));
            const current = closes[closes.length - 1];
            if (closes.length < 2) continue;
            const dayAgo = closes[closes.length - 2],
                weekAgo = closes.length > 7 ? closes[closes.length - 8] : dayAgo,
                monthAgo = closes.length > 30 ? closes[closes.length - 31] : weekAgo;
            const prefix = p.id.replace('-stats', '');
            const stat1d = document.getElementById(`${prefix}-stat-1d`),
                stat1s = document.getElementById(`${prefix}-stat-1s`),
                stat1m = document.getElementById(`${prefix}-stat-1m`);
            if (stat1d) { const val = ((current - dayAgo) / dayAgo) * 100;
                stat1d.textContent = (val >= 0 ? '+' : '') + val.toFixed(2) + '%';
                stat1d.className = 'stat ' + (val >= 0 ? 'positive' : 'negative'); }
            if (stat1s) { const val = ((current - weekAgo) / weekAgo) * 100;
                stat1s.textContent = (val >= 0 ? '+' : '') + val.toFixed(2) + '%';
                stat1s.className = 'stat ' + (val >= 0 ? 'positive' : 'negative'); }
            if (stat1m) { const val = ((current - monthAgo) / monthAgo) * 100;
                stat1m.textContent = (val >= 0 ? '+' : '') + val.toFixed(2) + '%';
                stat1m.className = 'stat ' + (val >= 0 ? 'positive' : 'negative'); }
        } catch (e) { console.warn('Daily stats error:', e); }
    }
}
document.addEventListener('click', function(e) {
    const btn = e.target.closest('.tf-btn');
    if (!btn) return;
    const parent = btn.closest('.tf-buttons');
    if (!parent) return;
    const symbol = parent.dataset.symbol;
    const containerId = parent.closest('.candle-card').querySelector('.candle-container').id;
    const interval = btn.dataset.tf;
    parent.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    updateCandleChart(containerId, symbol, interval);
});


let wsTickers = {};
function initTickerWebSocket(symbol, priceElementId, changeElementId, sourceElementId) {
    try {
        const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@ticker`);
        ws.onopen = () => { console.log(`✅ Ticker ${symbol} conectado`); };
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                const price = parseFloat(data.c),
                    change = parseFloat(data.P);
                if (price > 0) {
                    const priceEl = document.getElementById(priceElementId);
                    if (priceEl) { priceEl.textContent = formatCurrency(price);
                        priceEl.className = 'value ' + (change >= 0 ? 'positive' : 'negative'); }
                    const changeEl = document.getElementById(changeElementId);
                    if (changeEl) changeEl.textContent = (change >= 0 ? '+' : '') + change.toFixed(2) + '% (live)';
                    const sourceEl = document.getElementById(sourceElementId);
                    if (sourceEl) sourceEl.textContent = 'Binance (WebSocket) • ' + getCurrentTimestamp();
                }
            } catch (e) { console.warn(`Ticker ${symbol} parse error:`, e); }
        };
        ws.onclose = () => {
            console.warn(`Ticker ${symbol} fechado, reconectando em 5s...`);
            setTimeout(() => initTickerWebSocket(symbol, priceElementId, changeElementId, sourceElementId), 5000);
        };
        wsTickers[symbol] = ws;
    } catch (e) { console.warn(`Ticker ${symbol} init error:`, e); }
}
let wsCandles = null;


function initCandleWebSocket() {
    try {
        wsCandles = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@kline_1m');
        wsCandles.onmessage = async (event) => {
            try {
                const data = JSON.parse(event.data),
                    candle = data.k;
                if (candle.x) {
                    const chartObj = candleCharts['candle-btc'];
                    if (chartObj && document.querySelector('#candle-btc .tf-btn.active')?.dataset.tf === '1m') {
                        const newCandle = { time: candle.t / 1000, open: parseFloat(candle.o),
                            high: parseFloat(candle.h), low: parseFloat(candle.l),
                            close: parseFloat(candle.c) };
                        const series = chartObj.candleSeries;
                        const currentData = series.data();
                        const last = currentData[currentData.length - 1];
                        if (last && last.time === newCandle.time) series.update(newCandle);
                        else { series.add(newCandle); if (currentData.length > 60) series.setData([...currentData
                                .slice(1), newCandle
                            ]); }
                        chartObj.chart.timeScale().fitContent();
                    }
                    const close = parseFloat(candle.c);
                    candleHistory.push({ time: candle.t / 1000, open: parseFloat(candle.o),
                        high: parseFloat(candle.h), low: parseFloat(candle.l), close: close,
                        volume: parseFloat(candle.v) || 0 });
                    if (candleHistory.length > 50) candleHistory.shift();
                    updateLiveSupportResistance();


                    const closesLive = candleHistory.map(c => c.close);
                    const ema50Live = calculateEMA(closesLive, 50);
                    if (ema50Live !== null) ema50History.push(ema50Live);
                    if (ema50History.length > 100) ema50History.shift();


                    const closes = candleHistory.map(c => c.close);
                    rsiHistory.push(calculateRSI(closes));
                    const macdVal = calculateMACD(closes);
                    if (macdVal !== null) macdHistory.push(macdVal);
                    else macdHistory.push(0);
                    const obvVal = calculateOBV(candleHistory);
                    obvHistory.push(obvVal);
                    if (rsiHistory.length > 50) rsiHistory.shift();
                    if (macdHistory.length > 50) macdHistory.shift();
                    if (obvHistory.length > 50) obvHistory.shift();
                }
            } catch (e) { console.warn('Candle WebSocket parse error:', e); }
        };
        wsCandles.onclose = () => {
            console.warn('Candle WebSocket fechado, reconectando em 5s...');
            setTimeout(initCandleWebSocket, 5000);
        };
    } catch (e) { console.warn('Candle WebSocket init error:', e); }
}


// ================================================================
// FUNÇÕES DE API
// ================================================================
async function fetchFearGreed() {
    try {
        const r = await fetch('https://api.alternative.me/fng/?limit=1');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json(),
            item = data.data[0],
            value = item.value,
            classification = item.value_classification;
        const headerFng = document.getElementById('header-fng');
        headerFng.innerHTML = '😱 FEAR & GREED: ' + value + ' (' + classification + ')';
        headerFng.className = 'badge ' + (parseInt(value) <= 25 ? 'extreme-fear' : '');
        const headerSentiment = document.getElementById('header-sentiment');
        const sentimentText = (parseInt(value) <= 25) ? '⚠️ SENTIMENTO: PESSIMISTA' : (parseInt(value) <= 45 ?
            '⚠️ SENTIMENTO: NEUTRO' : '✅ SENTIMENTO: BULLISH');
        headerSentiment.textContent = sentimentText;
        headerSentiment.className = 'badge ' + (parseInt(value) <= 25 ? 'sentiment-bearish' : 'sentiment-bullish');
        updateLiveTime();
        // Atualiza painéis após mudança no Fear
        updateConfirmationPanel();
        updateAnalysisScores();
    } catch (e) { console.warn('FNG unavailable'); }
}
async function fetchDeFiData() {
    try {
        const r1 = await fetch('https://stablecoins.llama.fi/stablecoins');
        if (!r1.ok) throw new Error('HTTP ' + r1.status);
        const d1 = await r1.json();
        let totalSupply = 0;
        if (d1 && d1.peggedAssets) d1.peggedAssets.forEach(a => { if (a.total) totalSupply += a.total; });
        if (totalSupply > 0) { document.getElementById('stablecoin-supply').textContent = formatCurrency(totalSupply) +
                ' (live)';
            updateSourceTimestamp('stablecoin-source'); }
        const r2 = await fetch('https://api.llama.fi/charts');
        if (!r2.ok) throw new Error('HTTP ' + r2.status);
        const d2 = await r2.json();
        const lastTvl = d2[d2.length - 1]?.totalLiquidityUSD || 0,
            prevTvl = d2[d2.length - 2]?.totalLiquidityUSD || 0;
        if (lastTvl > 0) {
            const change = prevTvl ? ((lastTvl - prevTvl) / prevTvl) * 100 : 0;
            document.getElementById('defi-tvl').textContent = formatCurrency(lastTvl) + ' (live)';
            document.getElementById('defi-tvl').className = 'value ' + (change >= 0 ? 'positive' : 'negative');
            document.getElementById('defi-tvl-change').textContent = (change >= 0 ? '+' : '') + change.toFixed(2) +
                '% (live)';
            document.getElementById('defi-tvl-change').className = getChangeClass(change);
            document.getElementById('defi-tvl-interp').textContent = change >= 0 ? '✅ Entrada de liquidez' :
                '⚠️ Saída de liquidez';
            updateSourceTimestamp('defi-tvl-source');
            updateSourceTimestamp('defi-change-source');
        }
        updateLiveTime();
    } catch (e) { console.warn('DeFi data unavailable'); }
}
async function fetchBinanceDerivatives() {
    try {
        const r1 = await fetch('https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1');
        if (!r1.ok) throw new Error('HTTP ' + r1.status);
        const d1 = await r1.json();
        const fr = d1[0]?.fundingRate || 0;
        if (fr) {
            document.getElementById('funding-rate').textContent = (fr * 100).toFixed(4) + '% (live)';
            document.getElementById('funding-rate-interp').textContent = fr > 0.0001 ? '✅ Longs pagam' : fr < -
                0.0001 ? '🔴 Shorts pagam' : 'ℹ️ Neutro';
            updateSourceTimestamp('funding-rate-source');
            fundingHistory.push({ fundingRate: fr, timestamp: Date.now() });
            if (fundingHistory.length > 20) fundingHistory.shift();
        }
        const rAvg = await fetch('https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=8');
        if (rAvg.ok) {
            const dAvg = await rAvg.json();
            const avg = dAvg.reduce((s, i) => s + parseFloat(i.fundingRate), 0) / dAvg.length;
            if (!isNaN(avg)) { document.getElementById('funding-rate-avg').textContent = (avg * 100).toFixed(4) +
                    '% (live)';
                updateSourceTimestamp('funding-rate-avg-source'); }
        }
        const r2 = await fetch('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT');
        if (!r2.ok) throw new Error('HTTP ' + r2.status);
        const d2 = await r2.json();
        const currentOI = parseFloat(d2.openInterest) || 0;
        if (currentOI > 0) {
            document.getElementById('open-interest').textContent = formatCurrency(currentOI) + ' (live)';
            document.getElementById('open-interest-interp').textContent = currentOI > 1e9 ? '⚠️ Alto' : 'ℹ️ Moderado';
            updateSourceTimestamp('open-interest-source');
        }
        const prevOI = localStorage.getItem('prevOI') ? parseFloat(localStorage.getItem('prevOI')) : currentOI * 0.915;
        let oiDelta = 0;
        if (prevOI > 0 && currentOI > 0) {
            oiDelta = ((currentOI - prevOI) / prevOI) * 100;
            if (!isNaN(oiDelta)) {
                document.getElementById('oi-delta').textContent = (oiDelta >= 0 ? '+' : '') + oiDelta.toFixed(1) +
                    '% (live)';
                const interp = document.getElementById('oi-delta-interp');
                if (oiDelta > 10) {
                    interp.textContent = '⚠️ OI subiu >10% — divergência!';
                    interp.className = 'alert-divergence';
                    const price = document.getElementById('btc-price')?.textContent || 'N/A';
                    sendTelegramAlert(
                        `🚨 <b>ALERTA DE DIVERGÊNCIA</b>\n\n📊 OI subiu <b>${oiDelta.toFixed(1)}%</b> em 24h!\n💰 Preço BTC: ${price}\n⚠️ Possível divergência de preço e OI.`
                        );
                } else { interp.textContent = 'ℹ️ Variação normal';
                    interp.className = ''; }
                updateSourceTimestamp('oi-delta-source');
                globalData.oiDelta = oiDelta;
            }
        }
        localStorage.setItem('prevOI', currentOI);
        const r3 = await fetch('https://fapi.binance.com/fapi/v1/ticker/price?symbol=BTCUSDT');
        if (!r3.ok) throw new Error('HTTP ' + r3.status);
        const d3 = await r3.json();
        const perpPrice = parseFloat(d3.price) || 0;
        const spotResp = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
        const spotData = await spotResp.json();
        const spotPrice = spotData.bitcoin.usd || 0;
        if (perpPrice > 0 && spotPrice > 0) {
            const basis = ((perpPrice - spotPrice) / spotPrice) * 100;
            document.getElementById('basis').textContent = (basis >= 0 ? '+' : '') + basis.toFixed(2) + '% (live)';
            updateSourceTimestamp('basis-source');
        }
        const rLS = await fetch(
            'https://fapi.binance.com/fapi/v1/topLongShortPositionRatio?symbol=BTCUSDT&period=24h&limit=1');
        if (rLS.ok) {
            const dLS = await rLS.json();
            const item = dLS[0];
            if (item) {
                const longP = parseFloat(item.longPositionRatio) * 100,
                    shortP = parseFloat(item.shortPositionRatio) * 100;
                document.getElementById('ls-ratio-pos').textContent = longP.toFixed(1) + '% / ' + shortP.toFixed(1) +
                    '% (live)';
                const interp = document.getElementById('ls-ratio-pos-interp');
                if (longP > 70) {
                    interp.textContent = '⚠️ Long extremo (>70%)';
                    interp.className = 'alert-divergence';
                    const price = document.getElementById('btc-price')?.textContent || 'N/A';
                    sendTelegramAlert(
                        `⚠️ <b>ALERTA DE SENTIMENTO EXTREMO</b>\n\n📊 Long/Short Ratio: <b>${longP.toFixed(1)}%</b> de traders estão comprados.\n💰 Preço BTC: ${price}\n⚠️ Nível extremo (>70%) — possibilidade de correção.`
                        );
                } else { interp.textContent = 'ℹ️ Neutro';
                    interp.className = ''; }
                updateSourceTimestamp('ls-pos-source');
                globalData.rsi = 50 + (longP - 50) * 0.5;
            }
        }
        const rLSAcc = await fetch(
            'https://fapi.binance.com/fapi/v1/topLongShortAccountRatio?symbol=BTCUSDT&period=24h&limit=1');
        if (rLSAcc.ok) {
            const dLSAcc = await rLSAcc.json();
            const item = dLSAcc[0];
            if (item) {
                const longP = parseFloat(item.longAccountRatio) * 100,
                    shortP = parseFloat(item.shortAccountRatio) * 100;
                document.getElementById('ls-ratio-acc').textContent = longP.toFixed(1) + '% / ' + shortP.toFixed(1) +
                    '% (live)';
                updateSourceTimestamp('ls-acc-source');
            }
        }
        updateLiveTime();
        const scoreData = computeScore(globalData);
        updateScoreDisplay(scoreData);
        // Atualiza painéis após dados de derivativos
        updateConfirmationPanel();
        updateAnalysisScores();
    } catch (e) { console.warn('Binance derivatives unavailable'); }
}
async function fetchBRK() {
    const metrics = [{ id: 'mvrv', el: 'mvrv', interp: 'mvrv-interp', source: 'mvrv-source', fallback: '1,15' },
        { id: 'mvrv_short', el: 'mvrv-sth', interp: 'mvrv-sth-interp', source: 'mvrv-sth-source',
            fallback: '0,84' },
        { id: 'sopr', el: 'sopr', interp: 'sopr-interp', source: 'sopr-source', fallback: '0,80' },
        { id: 'sopr_adjusted', el: 'asopr', interp: 'asopr-interp', source: 'asopr-source',
        fallback: '0,99' },
        { id: 'realized_price', el: 'realized-price', interp: null, source: 'realized-price-source',
            fallback: '53600' },
        { id: 'active_addresses', el: 'active-addresses', interp: null, source: 'active-addresses-source',
            fallback: '605298' }
    ];
    await Promise.all(metrics.map(async m => {
        try {
            const url = `https://bitview.space/api/metrics/btc/${m.id}?resolution=1d`;
            const r = await fetch(url);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const data = await r.json();
            let val = data?.[0]?.[1];
            if (val !== undefined && val !== null) {
                let display = (m.id === 'realized_price' || m.id === 'active_addresses') ? Number(val)
                    .toLocaleString('en-US', { maximumFractionDigits: 0 }) : Number(val).toFixed(2);
                document.getElementById(m.el).textContent = display + ' (live)';
                if (m.id === 'realized_price') document.getElementById(m.el).textContent = '$' + display +
                    ' (live)';
                if (m.interp) {
                    const num = parseFloat(val);
                    let text = '';
                    if (m.id === 'mvrv') text = num > 1 ? '⚠️ Acima de 1.0' : 'ℹ️ Abaixo de 1.0';
                    else if (m.id === 'mvrv_short') text = num < 1 ? '✅ STH em perda' : '⚠️ STH em lucro';
                    else if (m.id === 'sopr') text = num < 1 ? '🔴 Weakness' : '🟢 Strength';
                    else if (m.id === 'sopr_adjusted') text = num < 1 ? '⚠️ Ajustado fraco' :
                        'ℹ️ Ajustado neutro';
                    document.getElementById(m.interp).textContent = text;
                }
                updateSourceTimestamp(m.source);
                if (m.id === 'mvrv') { globalData.mvrv = parseFloat(val);
                    updateConfirmationPanel(); }
                if (m.id === 'sopr') globalData.sopr = parseFloat(val);
                if (m.id === 'mvrv_short') updateConfirmationPanel(); // STH atualizado
            }
        } catch (e) { console.warn('BRK error for ' + m.id, e); }
    }));
}
async function fetchHashrate() {
    try {
        const r = await fetch('https://blockchain.info/q/hashrate', { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const text = await r.text();
        const hr = parseFloat(text) / 1e18;
        if (!isNaN(hr) && hr > 0) {
            document.getElementById('btc-hashrate').textContent = hr.toFixed(2) + ' EH/s (live)';
            updateSourceTimestamp('hashrate-source');
            updateLiveTime();
        }
    } catch (e) { console.warn('Hashrate unavailable'); }
}
async function fetchGasPrice() {
    try {
        const url =
            'https://api.etherscan.io/api?module=gastracker&action=gasoracle&apikey=NP3TFWDIPF1FFQ8DBBR9JUIUE9UFSUGSGU';
        const r = await fetch(url);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        if (data.status === '1') {
            const gasPrice = parseFloat(data.result.ProposeGasPrice) / 10;
            document.getElementById('eth-gas').textContent = gasPrice.toFixed(2) + ' Gwei (live)';
            updateSourceTimestamp('gas-source');
            updateLiveTime();
        }
    } catch (e) { console.warn('Gas price unavailable'); }
}


// ================================================================
// INICIALIZAÇÃO
// ================================================================
async function init() {
    loadWeightsV6();
    updateTimestamp();
    initWhaleFlowChart();
    initScoreChart();


    const whaleBtc = document.querySelector('#whale-btc .whale-action');
    if (whaleBtc) currentWhaleState = whaleBtc.textContent.trim().toLowerCase().includes('acumulando') ?
        'accumulating' : 'distributing';


    initTickerWebSocket('BTCUSDT', 'btc-price', 'btc-change', 'btc-source');
    initTickerWebSocket('ETHUSDT', 'eth-price', 'eth-change', 'eth-source');
    initTickerWebSocket('SOLUSDT', 'sol-price', 'sol-change', 'sol-source');


    await initCandles();
    initCandleWebSocket();


    setInterval(() => { updateTimestamp();
        updateLiveTime();
        updateAllSourceTimestamps(); }, 10000);
    setInterval(async () => {
        await fetchFearGreed();
        await fetchDeFiData();
        await fetchBRK();
        await fetchHashrate();
        await fetchGasPrice();
        await fetchBinanceDerivatives();
        const whaleBtc2 = document.querySelector('#whale-btc .whale-action');
        if (whaleBtc2) currentWhaleState = whaleBtc2.textContent.trim().toLowerCase().includes('acumulando') ?
            'accumulating' : 'distributing';
        // Atualiza painéis após cada ciclo
        updateConfirmationPanel();
        updateAnalysisScores();
    }, 300000);


    await fetchFearGreed();
    await fetchDeFiData();
    await fetchBRK();
    await fetchHashrate();
    await fetchGasPrice();
    await fetchBinanceDerivatives();


    const scoreData = computeScore(globalData);
    updateScoreDisplay(scoreData);


    document.getElementById('runBacktestBtn').addEventListener('click', runBacktest);
    setTimeout(runBacktest, 2000);


    updateTelegramStatus();
    const savedLog = localStorage.getItem('alertLog');
    if (savedLog) try { alertLog = JSON.parse(savedLog); } catch (e) {}


    document.getElementById('test-telegram-btn').addEventListener('click', async function() {
        const label = document.getElementById('test-btn-label');
        label.innerHTML = '<span class="spinner"></span> Enviando...';
        this.disabled = true;
        const success = await sendTestAlert();
        if (success) {
            label.textContent = '✅ Enviado!';
            setTimeout(() => { label.textContent = '📨 Testar Alerta';
                this.disabled = false; }, 2500);
        } else {
            label.textContent = '❌ Falha';
            setTimeout(() => { label.textContent = '📨 Testar Alerta';
                this.disabled = false; }, 3000);
        }
    });


    // Atualiza painéis ao carregar
    updateConfirmationPanel();
    updateAnalysisScores();
}
document.addEventListener('DOMContentLoaded', init);


window.sendTelegramAlert = sendTelegramAlert;
window.sendTestAlert = sendTestAlert;
window.runBacktest = runBacktest;
window.refreshAll = fetchBinanceDerivatives;
window.optimizeWeights = updateFilterWeightsV6;
window.filterWeights = filterWeights;
window.currentRegime = currentRegime;
window.globalData = globalData;
window.scoreHistory = scoreHistory;
