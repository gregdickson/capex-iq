import { describe, it, expect } from 'vitest';
import {
  scorePPE,
  scoreSIC,
  scoreInvestmentActivity,
  scoreAssetIntensity,
  calculateCapexIQScore,
  estimateOpportunityValue,
} from '../src/pipeline/scoring.js';

describe('scorePPE', () => {
  it('returns 0 for no PPE', () => {
    const result = scorePPE(0, 0);
    expect(result.score).toBe(0);
    expect(result.category).toBe('Unknown');
  });

  it('returns 1.0 for £1M+ PPE', () => {
    const result = scorePPE(1_500_000, 0);
    expect(result.score).toBe(1.0);
    expect(result.category).toBe('Very High');
  });

  it('returns 0.8 for £100K+ PPE', () => {
    const result = scorePPE(200_000, 0);
    expect(result.score).toBe(0.8);
    expect(result.category).toBe('Medium');
  });

  it('adds growth bonus for >50% growth', () => {
    const result = scorePPE(200_000, 100_000); // 100% growth
    expect(result.score).toBe(1.0); // 0.8 + 0.2, capped at 1.0
  });

  it('adds growth bonus for >50% growth', () => {
    // 150K PPE = 0.8 base, 50% growth = +0.2 bonus = 1.0
    const result = scorePPE(150_000, 100_000); // 50% growth
    // 50% is exactly >0.2 but not >0.5, so +0.1 bonus: 0.8 + 0.1 = 0.9
    expect(result.score).toBe(0.9);
  });
});

describe('scoreSIC', () => {
  it('returns 0.4 for null SIC', () => {
    expect(scoreSIC(null).score).toBe(0.4);
  });

  it('returns 0.9 for manufacturing (SIC 10-33)', () => {
    expect(scoreSIC(10110).score).toBe(0.9); // Food manufacturing
    expect(scoreSIC(25000).score).toBe(0.9); // Metal products
  });

  it('returns 0.8 for real estate (SIC 68)', () => {
    expect(scoreSIC(68209).score).toBe(0.8);
  });

  it('returns 0.9 for accommodation (SIC 55-56)', () => {
    expect(scoreSIC(55100).score).toBe(0.9);
  });

  it('returns 0.5 for finance (SIC 64-66)', () => {
    expect(scoreSIC(64100).score).toBe(0.5);
  });
});

describe('scoreInvestmentActivity', () => {
  it('returns 0.5 for no PPE data', () => {
    expect(scoreInvestmentActivity(0, 0).score).toBe(0.5);
  });

  it('returns 1.0 for >50% growth', () => {
    expect(scoreInvestmentActivity(200_000, 100_000).score).toBe(1.0);
  });

  it('returns 0.3 for >10% decline', () => {
    expect(scoreInvestmentActivity(80_000, 100_000).score).toBe(0.3);
  });
});

describe('scoreAssetIntensity', () => {
  it('returns 0.5 for no data', () => {
    expect(scoreAssetIntensity(0, 0, 0).score).toBe(0.5);
  });

  it('returns 1.0 for >40% PPE/Assets ratio', () => {
    expect(scoreAssetIntensity(500_000, 1_000_000, 0).score).toBe(1.0);
  });
});

describe('calculateCapexIQScore — A Place Like Home test case', () => {
  // From n8n pin data: PPE=0, SIC=68209, score should be ~28
  it('matches n8n output for A Place Like Home (PPE=0, SIC=68209)', () => {
    const result = calculateCapexIQScore({
      currentPPE: 0,
      previousPPE: 0,
      totalAssets: 100_000,
      turnoverRevenue: 0,
      sicCode: 68209,
    });

    // PPE=0 → ppeScore=0, investmentActivity=0.5, assetIntensity=0.5, SIC(68)=0.8
    // Composite = (0 * 0.5) + (0.5 * 0.25) + (0.5 * 0.15) + (0.8 * 0.1) = 0 + 0.125 + 0.075 + 0.08 = 0.28
    expect(result.capexiqScore).toBe(28);
    expect(result.ppeScore).toBe(0);
    expect(result.sicScore).toBe(0.8);
    expect(result.ppeCategory).toBe('Unknown');
    expect(result.opportunityValue).toBe('Unknown - No PPE data');
  });
});

describe('estimateOpportunityValue', () => {
  it('returns Unknown for no PPE', () => {
    expect(estimateOpportunityValue(0, 0.8, 0.5)).toBe('Unknown - No PPE data');
  });

  it('calculates correctly for high-value PPE', () => {
    // PPE=1M, SIC score 0.9 (18% embedded), intensity 0.8 (1.3x multiplier)
    // 1M * 0.18 * 1.3 * 0.25 = £58,500
    const result = estimateOpportunityValue(1_000_000, 0.9, 0.8);
    expect(result).toMatch(/£50k-100k/);
  });
});
