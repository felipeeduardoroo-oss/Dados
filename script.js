// ================================================================
// CONFIGURAÇÕES GLOBAIS
// ================================================================
// FIX: AVISO — Token exposto em hardcode. Em produção, injetar via variável de ambiente
// ou input de configuração. Nunca commitar credenciais em repositório público.
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
// FIX: Reduzido de 2000 para 500 — 2000 pontos causam degradação de performance
let scoreHistory = [];
const MAX_SCORE_HISTORY = 500;
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
    // FIX: Validação do JSON parseado — evita crash se o formato mudou entre versões
    try {
        const saved = localStorage.getItem('filterWeightsV6');
        if (!saved) return;
        const parsed = JSON.parse(saved);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
        for (const key of Object.keys(filterWeights)) {
            if (typeof parsed[key] === 'number' && parsed[key] > 0) {
                filterWeights[key] = parsed[key];
            }
        }
    } catch (e) {
        console.warn('⚠️ Falha ao carregar pesos persistidos, usando defaults:', e);
        localStorage.removeItem('filterWeightsV6');
    }
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
    // FIX: Limitar tamanho do histórico de ATR para evitar memory leak
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
        `MTF: ${scores.mtf_alignment.toFixed(0)}`, `OI: ${oi_score.toFixed(0)}`];
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

    // FIX: Null-safe — evita crash se elementos não existem no DOM
    if (sv) {
        sv.textContent = score;
        if (score >= 75) {
            sv.style.color = 'var(--accent-green)';
            if (sb) sb.style.background = 'var(--accent-green)';
        } else if (score <= 25) {
            sv.style.color = 'var(--accent-red)';
            if (sb) sb.style.background = 'var(--accent-red)';
        } else {
            sv.style.color = 'var(--accent-yellow)';
            if (sb) sb.style.background = 'var(--accent-yellow)';
        }
    }
    if (sb) sb.style.width = score + '%';

    // FIX: Null-safe para cada componente de score
    const componentIds = {
        'score-trend': components.trend,
        'score-momentum': components.momentum,
        'score-structure': components.structure,
        'score-onchain': components.onchain,
        'score-volume': components.volume,
        'score-oi': components.oi,
    };
    for (const [id, value] of Object.entries(componentIds)) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }




    // FIX: Limite enforcement no histórico — evita memory leak progressivo
    scoreHistory.push({ time: Date.now(), score: score });
    if (scoreHistory.length > MAX_SCORE_HISTORY) {
        scoreHistory.splice(0, scoreHistory.length - MAX_SCORE_HISTORY);
    }
    updateScoreChart();




    // FIX: checkAdditionalAlertsV13 era chamada mas nunca definida — stub adicionado
    if (typeof checkAdditionalAlertsV13 === 'function') {
        checkAdditionalAlertsV13(score, components);
    }
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
    if (!canvas || typeof Chart === 'undefined') return;
    // Plugin é passado apenas para esta instância, não registrado globalmente
    scoreChart = new Chart(canvas, {
        type: 'line',
        data: { datasets: [{ label: 'Score Institucional', data: [], borderColor: '#00b4d8',
                backgroundColor: 'rgba(0,180,216,0.1)', borderWidth: 2, fill: true, tension: 0.3,
                pointRadius: 1, pointHoverRadius: 4 }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            // FIX: animation desativada para performance em updates frequentes
            animation: false,
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

    // FIX: Downsample para no máximo 300 pontos — evita reflow excessivo no Canvas
    const maxPoints = 300;
    if (filtered.length > maxPoints) {
        const step = Math.ceil(filtered.length / maxPoints);
        filtered = filtered.filter((_, i) => i % step === 0);
    }

    scoreChart.data.datasets[0].data = filtered.map(p => ({ x: p.time, y: p.score }));
    scoreChart.update('none');
}




// FIX: Handler de clique dos botões de timeframe — estava truncado no original
document.addEventListener('click', function(e) {
    const btn = e.target.closest('#score-tf-buttons .tf-btn');
    if (!btn) return;
    const parent = btn.closest('#score-tf-buttons');
    if (!parent) return;
    parent.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentScoreTimeframe = btn.dataset.tf || '1h';
    updateScoreChart();
});




// ================================================================
// FIX: fetchCandles — referenciada em fetchMTFData() mas nunca definida
// ================================================================
async function fetchCandles(symbol, interval, limit) {
    try {
        const r = await fetch(
            `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
        );
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        return data.map(k => ({
            time: k[0],
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5]),
            closeTime: k[6],
        }));
    } catch (e) {
        console.warn(`⚠️ Falha ao buscar candles ${symbol} ${interval}:`, e);
        return null;
    }
}




// ================================================================
// FIX: checkAdditionalAlertsV13 — chamada em updateScoreDisplay() mas nunca definida
// Implementação mínima como placeholder — substituir pela lógica real
// ================================================================
function checkAdditionalAlertsV13(score, components) {
    const now = Date.now();
    if (now - lastAlertTime < ALERT_COOLDOWN) return;

    // Exemplo: alertar quando score cruza thresholds extremos
    if (score >= 85) {
        const regime = currentRegime || 'NEUTRO';
        console.log(`🔔 Score alto detectado: ${score} | Regime: ${regime}`);
        // Descomentar para ativar alertas reais via Telegram:
        // sendTelegramAlert(`🔥 <b>SCORE EXTREMO: ${score}/100</b>\nRegime: ${regime}\n⏰ ${getCurrentTimestamp()}`);
        // lastAlertTime = now;
    }

    if (score <= 15) {
        const regime = currentRegime || 'NEUTRO';
        console.log(`🔔 Score baixo detectado: ${score} | Regime: ${regime}`);
        // Descomentar para ativar alertas reais via Telegram:
        // sendTelegramAlert(`📉 <b>SCORE MÍNIMO: ${score}/100</b>\nRegime: ${regime}\n⏰ ${getCurrentTimestamp()}`);
        // lastAlertTime = now;
    }
}




// ================================================================
// FIX: Carregamento do alertLog do localStorage com validação
// ================================================================
function loadAlertLog() {
    try {
        const saved = localStorage.getItem('alertLog');
        if (!saved) return;
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed)) return;
        // Validar que cada entrada tem ao menos timestamp numérico
        alertLog = parsed.filter(t =>
            t && typeof t === 'object' && typeof t.timestamp === 'number'
        );
    } catch (e) {
        console.warn('⚠️ Falha ao carregar alertLog do localStorage:', e);
        alertLog = [];
        localStorage.removeItem('alertLog');
    }
}




// ================================================================
// FIX: Inicialização — o código original não tinha ponto de entrada
// ================================================================
function initApp() {
    console.log('🚀 BTC Analyzer v13 — Inicializando...');
    loadWeightsV6();
    loadAlertLog();
    initScoreChart();
    console.log(`✅ Pronto. AlertLog: ${alertLog.length} registros | Pesos carregados.`);
}

// Executar init quando o DOM estiver pronto
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
