import type { MatchPulseEvent, MatchScenarioId } from './types';

function clampProb(p: number): number {
  return Math.min(0.985, Math.max(0.015, p));
}

export function probToLogOdds(prob: number): number {
  const safe = clampProb(prob);
  return Math.log(safe / (1 - safe));
}

export function logOddsToProb(logOdds: number): number {
  const p = 1 / (1 + Math.exp(-logOdds));
  return Number(clampProb(p).toFixed(4));
}

/**
 * Computes match-state implied win probability from prior probability (or pre-pulse
 * market mid) and Bayesian objective log-odds jump, with optional time-decay as
 * CLOB market makers catch up.
 */
export function computeImpliedFairProb(
  priorProb: number,
  deltaLogOdds: number,
  elapsedMs = 0,
  halfLifeMs = 15000
): number {
  const decayFactor =
    elapsedMs <= 0 ? 1 : Math.pow(0.5, elapsedMs / Math.max(1000, halfLifeMs));
  const updatedLogOdds = probToLogOdds(priorProb) + deltaLogOdds * decayFactor;
  return logOddsToProb(updatedLogOdds);
}

export interface PulseTemplate {
  key: string;
  clockLabel: string;
  scoreLabel: string;
  headline: string;
  detail: string;
  deltaLogOdds: number;
  adverseWhaleFlowUsdc: number;
  cuiBonoSafe: boolean;
  whaleNote: string;
  syntheticSpreadOverride?: number;
  syntheticDepthScale?: number;
}

export const SCENARIO_PULSES: Record<MatchScenarioId, PulseTemplate[]> = {
  'lol-baron': [
    {
      key: 'lol-wide-spread-noise',
      clockLabel: '26:42',
      scoreLabel: 'T1 2 - 2 BLG · KILLS 11-11',
      headline: 'River Vision Skirmish (MM Quote Widened)',
      detail:
        'Support trade in river; market makers pull quotes to 6.6c spread -> Risk Gate silently blocks.',
      deltaLogOdds: 0.28,
      adverseWhaleFlowUsdc: 120,
      cuiBonoSafe: true,
      whaleNote: 'Neutral flow ($120)',
      syntheticSpreadOverride: 0.066,
    },
    {
      key: 'lol-whale-toxicity-trap',
      clockLabel: '27:19',
      scoreLabel: 'T1 2 - 2 BLG · KILLS 11-12',
      headline: 'Top Bush Pick vs Counter-Whale Sweep',
      detail:
        'Positive EV whale ($1,640 NO sweep) detected ahead of injury/pause rumor -> Pre-Headline Sentinel blocks.',
      deltaLogOdds: 0.34,
      adverseWhaleFlowUsdc: 1640,
      cuiBonoSafe: false,
      whaleNote: 'ALERT: $1,640 smart-money counter-sweep',
    },
    {
      key: 'lol-tier2-tower-edge',
      clockLabel: '27:51',
      scoreLabel: 'T1 2 - 2 BLG · GOLD +1.8K',
      headline: 'Mid Tier-2 Turret + Herald Charge',
      detail:
        'Clean map-control swing (+6.2c lag vs CLOB ask); moderate edge suitable for optional pass or swipe-dismiss.',
      deltaLogOdds: 0.27,
      adverseWhaleFlowUsdc: 80,
      cuiBonoSafe: true,
      whaleNote: 'Whale flow clean ($80)',
    },
    {
      key: 'lol-baron-steal-ace',
      clockLabel: '28:14',
      scoreLabel: 'T1 2 - 2 BLG · BARON + 4-0 ACE',
      headline: 'BARON NASHOR STEAL + 4-FOR-0 TEAMFIGHT ACE',
      detail:
        'Decisive objective swing! Fair win probability jumps +16c before Polymarket CLOB reprices.',
      deltaLogOdds: 0.72,
      adverseWhaleFlowUsdc: 45,
      cuiBonoSafe: true,
      whaleNote: 'Whale Sentinel CLEAR ($45)',
    },
  ],
  'nba-clutch': [
    {
      key: 'nba-timeout-wide-spread',
      clockLabel: 'Q4 03:12',
      scoreLabel: 'OKC 101 - 103 IND',
      headline: 'Coach Challenge Review (6.4c Wide Spread)',
      detail:
        'Official review freezes liquidity; spread widens to 6.4c (> 4.0c cap) -> Silent block.',
      deltaLogOdds: 0.31,
      adverseWhaleFlowUsdc: 190,
      cuiBonoSafe: true,
      whaleNote: 'Flow neutral ($190)',
      syntheticSpreadOverride: 0.064,
    },
    {
      key: 'nba-transition-layup',
      clockLabel: 'Q4 02:44',
      scoreLabel: 'OKC 103 - 103 IND',
      headline: 'SGA Steal + Transition And-One',
      detail:
        'Tie-game momentum swing (+5.8c CLOB lag) with 1.0c tight spread and deep $13.7k top ask.',
      deltaLogOdds: 0.29,
      adverseWhaleFlowUsdc: 110,
      cuiBonoSafe: true,
      whaleNote: 'Whale Sentinel CLEAR',
    },
    {
      key: 'nba-clutch-8-0-run',
      clockLabel: 'Q4 01:52',
      scoreLabel: 'OKC 109 - 103 IND (8-0 RUN)',
      headline: 'CLUTCH 8-0 RUN: BACK-TO-BACK STEAL + CORNER 3PT',
      detail:
        'Live broadcast shows corner 3 splash + Pacers forced timeout; CLOB still resting at 64c (+14.4c Edge).',
      deltaLogOdds: 0.74,
      adverseWhaleFlowUsdc: 60,
      cuiBonoSafe: true,
      whaleNote: 'Whale Sentinel CLEAR ($60)',
    },
  ],
  'nfl-redzone': [
    {
      key: 'nfl-thin-depth-noise',
      clockLabel: 'Q4 04:15',
      scoreLabel: 'CIN 24 - 20 WAS',
      headline: '3rd & 8 Incomplete Pass (Thin Ask Rung)',
      detail:
        'Top ask rung depleted to $12 (< $25 depth floor) -> Fail-closed silent block.',
      deltaLogOdds: 0.32,
      adverseWhaleFlowUsdc: 90,
      cuiBonoSafe: true,
      whaleNote: 'Depth insufficient ($12)',
      syntheticDepthScale: 0.0003,
    },
    {
      key: 'nfl-redzone-interception',
      clockLabel: 'Q4 02:58',
      scoreLabel: 'CIN 24 - 20 WAS · CIN BALL',
      headline: 'REDZONE INTERCEPTION AT GOAL LINE',
      detail:
        'Goal-line turnover flips win probability from 72.5% to 88.2% while CLOB ask lags at 73.0c (+15.2c Edge).',
      deltaLogOdds: 1.04,
      adverseWhaleFlowUsdc: 75,
      cuiBonoSafe: true,
      whaleNote: 'Whale Sentinel CLEAR ($75)',
    },
  ],
};

export function materializePulseEvent(
  scenarioId: MatchScenarioId,
  sportTag: string,
  template: PulseTemplate,
  referenceMidProb: number,
  nowMs = Date.now()
): MatchPulseEvent {
  const priorWinProb = Number(clampProb(referenceMidProb).toFixed(4));
  const impliedFairProb = computeImpliedFairProb(
    priorWinProb,
    template.deltaLogOdds,
    0
  );

  return {
    id: `${template.key}-${nowMs}`,
    scenarioId,
    sportTag,
    clockLabel: template.clockLabel,
    scoreLabel: template.scoreLabel,
    headline: template.headline,
    detail: template.detail,
    deltaLogOdds: template.deltaLogOdds,
    priorWinProb,
    impliedFairProb,
    adverseWhaleFlowUsdc: template.adverseWhaleFlowUsdc,
    cuiBonoSafe: template.cuiBonoSafe,
    whaleNote: template.whaleNote,
    syntheticSpreadOverride: template.syntheticSpreadOverride,
    syntheticDepthScale: template.syntheticDepthScale,
    createdAtMs: nowMs,
  };
}
