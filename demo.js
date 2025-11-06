// Erevos Demo Core (browser-side simulation)
// v1.3.0 – ACTIVE / PAUSED / STABILISING, target chasing, stats.

/* ------------------------------------------------------------------ */
/* Config & State                                                      */
/* ------------------------------------------------------------------ */

const config = {
  smoothingAlpha: 0.9,
  velocityAlpha: 0.6,
  zeroDeadband: 0.02,
  maxAbsBalance: 5.0,
  maxAbsVelocity: 2.0,
  pauseOnViolation: true,
  autoRestart: true,

  softBandMinFraction: 0.3,
  softBandPrefFraction: 0.5,

  restartThresholdFraction: 0.15,
  restartConfirmTicks: 4,
  recoveryGain: 0.7,

  targetRelative: 0.0,

  controlBias: 0.6,  // 0 = follow external only, 1 = chase target only
  controlGain: 0.9,

  inputMode: "auto",
  useEnvNoise: false,
  noiseLevel: 0.25,
  manualInput: 0.0,
};

const state = {
  tick: 0,
  balance: 0.0,
  velocity: 0.0,
  targetBalance: 0.0,
  softMin: 0.0,
  softMax: 0.0,
  lastInput: 0.0,

  status: "ACTIVE",          // "ACTIVE" | "PAUSED"
  mode: "ACTIVE",            // "ACTIVE" | "STABILISING" | "PAUSED"
  guardrailHits: 0,
  pauses: 0,
  stableTicks: 0,
  recoveryStableTicks: 0,

  history: [],
  maxHistory: 120,
  graphPoints: [],
  maxGraphPoints: 180,

  avgStability: 1.0,
};

/* ------------------------------------------------------------------ */
/* Helpers & bands                                                    */
/* ------------------------------------------------------------------ */

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function updateTargetAndBands() {
  const maxB = Math.abs(config.maxAbsBalance) || 1.0;
  const t = clamp(config.targetRelative, -1, 1) * maxB;
  state.targetBalance = t;

  const minWidth = maxB * Math.max(0, config.softBandMinFraction);
  const prefWidth = maxB * Math.max(0, config.softBandPrefFraction);
  const width = Math.max(minWidth, prefWidth);
  const half = width / 2;

  let softMin = t - half;
  let softMax = t + half;

  if (softMin < -maxB) {
    const shift = -maxB - softMin;
    softMin += shift;
    softMax += shift;
  }
  if (softMax > maxB) {
    const shift = softMax - maxB;
    softMin -= shift;
    softMax -= shift;
  }

  softMin = Math.max(softMin, -maxB);
  softMax = Math.min(softMax, maxB);

  state.softMin = softMin;
  state.softMax = softMax;
}

updateTargetAndBands();

/* ------------------------------------------------------------------ */
/* DOM references                                                     */
/* ------------------------------------------------------------------ */

const canvas = document.getElementById("balanceCanvas");
let ctx = canvas && canvas.getContext ? canvas.getContext("2d") : null;

const graphStateChip = document.getElementById("graphStateChip");
const graphStateDot = document.getElementById("graphStateDot");
const graphStateText = document.getElementById("graphStateText");

const metricBalance = document.getElementById("metricBalance");
const metricTarget = document.getElementById("metricTarget");
const metricStability = document.getElementById("metricStability");
const metricMode = document.getElementById("metricMode");

const stateBadge = document.getElementById("stateBadge");
const stateTitle = document.getElementById("stateTitle");
const stateDescription = document.getElementById("stateDescription");

const logArea = document.getElementById("logArea");

const targetSlider = document.getElementById("targetBalanceSlider");
const targetValue = document.getElementById("targetBalanceValue");

const autoModeBtn = document.getElementById("autoModeBtn");
const manualModeBtn = document.getElementById("manualModeBtn");
const envNoiseBtn = document.getElementById("envNoiseBtn");
const autoRestartToggle = document.getElementById("autoRestartToggle");

const manualInputRow = document.getElementById("manualInputRow");
const manualInputSlider = document.getElementById("manualInputSlider");
const manualInputValue = document.getElementById("manualInputValue");

const smoothingSlider = document.getElementById("smoothingSlider");
const smoothingValue = document.getElementById("smoothingValue");
const velocitySlider = document.getElementById("velocitySlider");
const velocityValue = document.getElementById("velocityValue");
const deadbandSlider = document.getElementById("deadbandSlider");
const deadbandValue = document.getElementById("deadbandValue");

const maxBalanceSlider = document.getElementById("maxBalanceSlider");
const maxBalanceValue = document.getElementById("maxBalanceValue");
const maxVelocitySlider = document.getElementById("maxVelocitySlider");
const maxVelocityValue = document.getElementById("maxVelocityValue");
const softBandSlider = document.getElementById("softBandSlider");
const softBandValue = document.getElementById("softBandValue");

const noiseLevelSlider = document.getElementById("noiseLevelSlider");
const noiseLevelValue = document.getElementById("noiseLevelValue");

const presetBalanced = document.getElementById("presetBalanced");
const presetReactive = document.getElementById("presetReactive");
const presetSoft = document.getElementById("presetSoft");
const presetButtons = [presetBalanced, presetReactive, presetSoft];

// stats elements
const statAvgStability = document.getElementById("statAvgStability");
const statStableTicks = document.getElementById("statStableTicks");
const statGuardrails = document.getElementById("statGuardrails");
const statPauses = document.getElementById("statPauses");

/* ------------------------------------------------------------------ */
/* Presets                                                            */
/* ------------------------------------------------------------------ */

function applyPreset(name) {
  if (name === "balanced") {
    config.smoothingAlpha = 0.9;
    config.velocityAlpha = 0.6;
    config.zeroDeadband = 0.02;
    config.maxAbsBalance = 5.0;
    config.maxAbsVelocity = 1.6;
    config.softBandPrefFraction = 0.5;
    config.noiseLevel = 0.22;
    config.targetRelative = 0.0;
    config.controlBias = 0.65;
    config.controlGain = 0.9;
  } else if (name === "reactive") {
    config.smoothingAlpha = 0.8;
    config.velocityAlpha = 0.55;
    config.zeroDeadband = 0.015;
    config.maxAbsBalance = 5.0;
    config.maxAbsVelocity = 2.2;
    config.softBandPrefFraction = 0.35;
    config.noiseLevel = 0.28;
    config.targetRelative = 0.0;
    config.controlBias = 0.45;
    config.controlGain = 1.0;
  } else if (name === "soft") {
    config.smoothingAlpha = 0.93;
    config.velocityAlpha = 0.55;
    config.zeroDeadband = 0.02;
    config.maxAbsBalance = 5.0;
    config.maxAbsVelocity = 1.5;
    config.softBandPrefFraction = 0.75;
    config.noiseLevel = 0.18;
    config.targetRelative = 0.0;
    config.controlBias = 0.78;
    config.controlGain = 0.8;
  }

  updateTargetAndBands();
  syncSlidersFromConfig();
  setActivePreset(name);
}

function setActivePreset(name) {
  presetButtons.forEach(btn => btn && btn.classList.remove("active"));
  if (name === "balanced" && presetBalanced) presetBalanced.classList.add("active");
  if (name === "reactive" && presetReactive) presetReactive.classList.add("active");
  if (name === "soft" && presetSoft) presetSoft.classList.add("active");
}

/* ------------------------------------------------------------------ */
/* Sliders & controls                                                 */
/* ------------------------------------------------------------------ */

function syncSlidersFromConfig() {
  if (!smoothingSlider) return;

  smoothingSlider.value = Math.round(config.smoothingAlpha * 100);
  smoothingValue.textContent = config.smoothingAlpha.toFixed(2);

  velocitySlider.value = Math.round(config.velocityAlpha * 100);
  velocityValue.textContent = config.velocityAlpha.toFixed(2);

  deadbandSlider.value = Math.round(config.zeroDeadband * 100);
  deadbandValue.textContent = config.zeroDeadband.toFixed(2);

  maxBalanceSlider.value = Math.round(config.maxAbsBalance * 100);
  maxBalanceValue.textContent = config.maxAbsBalance.toFixed(2);

  maxVelocitySlider.value = Math.round(config.maxAbsVelocity * 100);
  maxVelocityValue.textContent = config.maxAbsVelocity.toFixed(2);

  softBandSlider.value = Math.round(config.softBandPrefFraction * 100);
  softBandValue.textContent = config.softBandPrefFraction.toFixed(2);

  targetSlider.value = Math.round(config.targetRelative * 100);
  targetValue.textContent = state.targetBalance.toFixed(2);

  noiseLevelSlider.value = Math.round(config.noiseLevel * 100);
  noiseLevelValue.textContent = config.noiseLevel.toFixed(2);

  manualInputSlider.value = Math.round((config.manualInput + 1) * 50);
  manualInputValue.textContent = config.manualInput.toFixed(2);
}

syncSlidersFromConfig();
updateTargetAndBands();

/* sliders */

if (smoothingSlider) {
  smoothingSlider.addEventListener("input", () => {
    config.smoothingAlpha = smoothingSlider.value / 100;
    smoothingValue.textContent = config.smoothingAlpha.toFixed(2);
  });

  velocitySlider.addEventListener("input", () => {
    config.velocityAlpha = velocitySlider.value / 100;
    velocityValue.textContent = config.velocityAlpha.toFixed(2);
  });

  deadbandSlider.addEventListener("input", () => {
    config.zeroDeadband = deadbandSlider.value / 100;
    deadbandValue.textContent = config.zeroDeadband.toFixed(2);
  });

  maxBalanceSlider.addEventListener("input", () => {
    config.maxAbsBalance = maxBalanceSlider.value / 100;
    maxBalanceValue.textContent = config.maxAbsBalance.toFixed(2);
    updateTargetAndBands();
  });

  maxVelocitySlider.addEventListener("input", () => {
    config.maxAbsVelocity = maxVelocitySlider.value / 100;
    maxVelocityValue.textContent = config.maxAbsVelocity.toFixed(2);
  });

  softBandSlider.addEventListener("input", () => {
    config.softBandPrefFraction = softBandSlider.value / 100;
    softBandValue.textContent = config.softBandPrefFraction.toFixed(2);
    updateTargetAndBands();
  });

  targetSlider.addEventListener("input", () => {
    config.targetRelative = targetSlider.value / 100;
    updateTargetAndBands();
    targetValue.textContent = state.targetBalance.toFixed(2);
  });

  noiseLevelSlider.addEventListener("input", () => {
    config.noiseLevel = noiseLevelSlider.value / 100;
    noiseLevelValue.textContent = config.noiseLevel.toFixed(2);
  });

  manualInputSlider.addEventListener("input", () => {
    const v = manualInputSlider.value / 50 - 1;
    config.manualInput = v;
    manualInputValue.textContent = v.toFixed(2);
  });
}

/* modes */

function setInputMode(mode) {
  config.inputMode = mode;
  autoModeBtn.classList.toggle("active", mode === "auto");
  manualModeBtn.classList.toggle("active", mode === "manual");
  manualInputRow.style.display = mode === "manual" ? "grid" : "none";
}

autoModeBtn.addEventListener("click", () => setInputMode("auto"));
manualModeBtn.addEventListener("click", () => setInputMode("manual"));

envNoiseBtn.addEventListener("click", () => {
  config.useEnvNoise = !config.useEnvNoise;
  envNoiseBtn.classList.toggle("active", config.useEnvNoise);
});

autoRestartToggle.checked = config.autoRestart;
autoRestartToggle.addEventListener("change", () => {
  config.autoRestart = autoRestartToggle.checked;
});

/* presets click */

presetBalanced.addEventListener("click", () => applyPreset("balanced"));
presetReactive.addEventListener("click", () => applyPreset("reactive"));
presetSoft.addEventListener("click", () => applyPreset("soft"));
applyPreset("balanced");

/* ------------------------------------------------------------------ */
/* Core simulation                                                    */
/* ------------------------------------------------------------------ */

function computeRecoveryInput() {
  const maxB = Math.abs(config.maxAbsBalance) || 1.0;
  const error = state.targetBalance - state.balance;
  let y = config.recoveryGain * error;
  y /= maxB;
  return clamp(y, -1, 1);
}

function generateAutoInput() {
  const maxB = Math.abs(config.maxAbsBalance) || 1.0;

  const wave1 = Math.sin(state.tick / 32) * 0.45;
  const wave2 = Math.sin(state.tick / 11) * 0.25;
  let base = wave1 + wave2;

  let noise = 0;
  if (config.useEnvNoise) {
    noise = (Math.random() * 2 - 1) * config.noiseLevel;
  }

  const error = (state.targetBalance - state.balance) / maxB;
  const control = clamp(error * config.controlGain, -1, 1);

  const mix = clamp(config.controlBias, 0, 1);
  const combined = base * (1 - mix) + control * mix + noise;

  return clamp(combined, -1, 1);
}

function step() {
  if (state.status === "PAUSED" && !config.autoRestart && state.mode === "PAUSED") {
    updateUi();
    return;
  }

  state.tick += 1;
  const maxB = Math.abs(config.maxAbsBalance) || 1.0;

  let rawInput;
  if (state.mode === "STABILISING") {
    rawInput = computeRecoveryInput();
  } else if (config.inputMode === "manual") {
    rawInput = config.manualInput;
  } else {
    rawInput = generateAutoInput();
  }

  let effInput = Math.abs(rawInput) < config.zeroDeadband ? 0.0 : rawInput;

  const alpha = config.smoothingAlpha;
  state.lastInput = alpha * state.lastInput + (1 - alpha) * effInput;

  const desired = state.balance + state.lastInput;
  let delta = desired - state.balance;
  delta = clamp(delta, -config.maxAbsVelocity, config.maxAbsVelocity);
  const appliedDelta = config.velocityAlpha * delta;
  let newBalance = state.balance + appliedDelta;

  if (Math.abs(newBalance) > maxB) {
    state.guardrailHits += 1;
    newBalance = clamp(newBalance, -maxB, maxB);

    if (config.pauseOnViolation) {
      state.pauses += 1;

      if (config.autoRestart) {
        state.status = "PAUSED";
        state.mode = "STABILISING";
        state.recoveryStableTicks = 0;
      } else {
        state.status = "PAUSED";
        state.mode = "PAUSED";
      }
    }
  }

  state.balance = newBalance;
  state.velocity = appliedDelta;

  if (state.status === "ACTIVE") {
    if (state.softMin <= state.balance && state.balance <= state.softMax) {
      state.stableTicks += 1;
    }
  }

  if (state.mode === "STABILISING") {
    const dist = Math.abs(state.balance - state.targetBalance);
    const threshold = config.restartThresholdFraction * maxB;
    if (dist <= threshold) state.recoveryStableTicks += 1;
    else state.recoveryStableTicks = 0;

    if (state.recoveryStableTicks >= config.restartConfirmTicks) {
      state.status = "ACTIVE";
      state.mode = "ACTIVE";
      state.recoveryStableTicks = 0;
    }
  }

  const dist = Math.abs(state.balance - state.targetBalance);
  const stability = 1 - Math.min(1, dist / maxB);
  state.avgStability = 0.97 * state.avgStability + 0.03 * stability;

  const msg =
    `Tick ${state.tick.toString().padStart(4, " ")} | ` +
    `in=${state.lastInput.toFixed(3).padStart(7, " ")} | ` +
    `bal=${state.balance.toFixed(3).padStart(7, " ")} | ` +
    `tgt=${state.targetBalance.toFixed(3).padStart(7, " ")} | ` +
    `vel=${state.velocity.toFixed(3).padStart(7, " ")} | ` +
    `mode=${state.mode.padEnd(11, " ")} | ` +
    `status=${state.status}`;

  state.history.push(msg);
  if (state.history.length > state.maxHistory) {
    state.history = state.history.slice(-state.maxHistory);
  }

  state.graphPoints.push(state.balance);
  if (state.graphPoints.length > state.maxGraphPoints) {
    state.graphPoints.shift();
  }

  updateUi();
}

/* ------------------------------------------------------------------ */
/* Drawing & UI                                                       */
/* ------------------------------------------------------------------ */

function resizeCanvasIfNeeded() {
  if (!canvas || !ctx) return;
  const rect = canvas.getBoundingClientRect();
  const w = Math.floor(rect.width * window.devicePixelRatio);
  const h = Math.floor(rect.height * window.devicePixelRatio);

  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function drawGraph() {
  if (!canvas || !ctx) return;

  resizeCanvasIfNeeded();

  const w = canvas.width;
  const h = canvas.height;
  const ctx2 = ctx;

  ctx2.clearRect(0, 0, w, h);

  const grd = ctx2.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, "#181f33");
  grd.addColorStop(1, "#050811");
  ctx2.fillStyle = grd;
  ctx2.fillRect(0, 0, w, h);

  const maxB = Math.abs(config.maxAbsBalance) || 1.0;

  function yForValue(v) {
    const top = 10;
    const bottom = h - 10;
    const span = bottom - top;
    const norm = (v + maxB) / (2 * maxB);
    return bottom - norm * span;
  }

  // zero
  ctx2.strokeStyle = "rgba(255,255,255,0.12)";
  ctx2.lineWidth = 1;
  ctx2.setLineDash([4, 4]);
  ctx2.beginPath();
  const y0 = yForValue(0);
  ctx2.moveTo(8, y0);
  ctx2.lineTo(w - 8, y0);
  ctx2.stroke();

  // hard limits
  ctx2.setLineDash([3, 5]);
  ctx2.strokeStyle = "rgba(255,79,107,0.35)";
  ctx2.beginPath();
  const yMax = yForValue(maxB);
  ctx2.moveTo(8, yMax);
  ctx2.lineTo(w - 8, yMax);
  ctx2.stroke();
  ctx2.beginPath();
  const yMin = yForValue(-maxB);
  ctx2.moveTo(8, yMin);
  ctx2.lineTo(w - 8, yMin);
  ctx2.stroke();

  // soft band
  ctx2.setLineDash([]);
  ctx2.fillStyle = "rgba(79, 156, 255, 0.10)";
  const ySoftTop = yForValue(state.softMax);
  const ySoftBottom = yForValue(state.softMin);
  ctx2.fillRect(8, ySoftTop, w - 16, ySoftBottom - ySoftTop);

  ctx2.strokeStyle = "rgba(79,156,255,0.6)";
  ctx2.lineWidth = 1;
  ctx2.beginPath();
  ctx2.moveTo(8, ySoftTop);
  ctx2.lineTo(w - 8, ySoftTop);
  ctx2.stroke();
  ctx2.beginPath();
  ctx2.moveTo(8, ySoftBottom);
  ctx2.lineTo(w - 8, ySoftBottom);
  ctx2.stroke();

  // target line
  const yT = yForValue(state.targetBalance);
  ctx2.strokeStyle = "rgba(191, 215, 255, 0.7)";
  ctx2.setLineDash([2, 3]);
  ctx2.beginPath();
  ctx2.moveTo(8, yT);
  ctx2.lineTo(w - 8, yT);
  ctx2.stroke();

  // balance trace
  if (state.graphPoints.length > 1) {
    ctx2.setLineDash([]);
    ctx2.strokeStyle = "#4fe28c";
    ctx2.lineWidth = 2;
    ctx2.beginPath();
    const span = state.graphPoints.length;
    for (let i = 0; i < span; i++) {
      const v = state.graphPoints[i];
      const x = 8 + ((w - 16) * i) / (span - 1 || 1);
      const y = yForValue(v);
      if (i === 0) ctx2.moveTo(x, y);
      else ctx2.lineTo(x, y);
    }
    ctx2.stroke();
  }
}

function updateStateDisplay() {
  if (metricBalance) metricBalance.textContent = state.balance.toFixed(2);
  if (metricTarget) metricTarget.textContent = state.targetBalance.toFixed(2);
  if (metricStability) metricStability.textContent = (state.avgStability * 100).toFixed(0) + "%";
  if (metricMode) metricMode.textContent = state.mode.charAt(0) + state.mode.slice(1).toLowerCase();

  const t = state.status;
  const m = state.mode;

  let chipText = "Active";
  let dotClass = "dot";
  let badgeText = "Active";
  let badgeClass = "pill pill-success badge-tight";
  let title = "System active";
  let desc = "Balance is within the comfort band. Erevos is responding normally to input.";

  if (m === "STABILISING") {
    chipText = "Stabilising";
    dotClass = "dot-warning";
    badgeText = "Stabilising";
    badgeClass = "pill pill-warning badge-tight";
    title = "System stabilising";
    desc = "Input has been paused while Erevos recentres itself towards the target balance.";
  } else if (t === "PAUSED" && m === "PAUSED") {
    chipText = "Paused";
    dotClass = "dot-danger";
    badgeText = "Paused";
    badgeClass = "pill pill-danger badge-tight";
    title = "System paused";
    desc = "A stability limit was exceeded. Auto-resume is disabled, so manual reset is required.";
  }

  if (graphStateText) graphStateText.textContent = chipText;
  if (graphStateDot) graphStateDot.className = dotClass;
  if (stateBadge) {
    stateBadge.className = badgeClass;
    stateBadge.textContent = badgeText;
  }
  if (stateTitle) stateTitle.textContent = title;
  if (stateDescription) stateDescription.textContent = desc;

  // stats
  if (statAvgStability) {
    statAvgStability.textContent = (state.avgStability * 100).toFixed(0) + "%";
  }
  if (statStableTicks) {
    statStableTicks.textContent = state.stableTicks.toString();
  }
  if (statGuardrails) {
    statGuardrails.textContent = state.guardrailHits.toString();
  }
  if (statPauses) {
    statPauses.textContent = state.pauses.toString();
  }
}

function updateLog() {
  if (!logArea) return;
  logArea.textContent = state.history.join("\n");
  logArea.scrollTop = logArea.scrollHeight;
}

function updateUi() {
  drawGraph();
  updateStateDisplay();
  updateLog();
}

/* ------------------------------------------------------------------ */
/* Loop                                                               */
/* ------------------------------------------------------------------ */

updateUi();
setInterval(step, 80);
