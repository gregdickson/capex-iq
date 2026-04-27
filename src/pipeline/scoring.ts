// CapexIQ Scoring Engine — exact port from n8n WF 02 "CapexIQ Scoring" Code node
// Weights: PPE 50%, Investment Activity 25%, Asset Intensity 15%, SIC 10%

export interface ScoringInput {
  currentPPE: number;
  previousPPE: number;
  totalAssets: number;
  turnoverRevenue: number;
  sicCode: number | string | null;
}

export interface ScoringResult {
  capexiqScore: number;
  ppeScore: number;
  sicScore: number;
  investmentActivityScore: number;
  assetIntensityScore: number;
  ppeCategory: string;
  opportunityValue: string;
  indicators: string[];
}

interface ComponentResult {
  score: number;
  category: string;
  indicators: string[];
}

const WEIGHTS = {
  ppe: 0.50,
  investmentActivity: 0.25,
  assetIntensity: 0.15,
  sic: 0.10,
} as const;

// PPE Value -> 0-1 score
export function scorePPE(currentPPE: number, previousPPE: number): ComponentResult {
  if (!currentPPE) return { score: 0, category: 'Unknown', indicators: ['No PPE data'] };

  let score = currentPPE >= 1_000_000 ? 1.0
    : currentPPE >= 500_000 ? 0.9
    : currentPPE >= 100_000 ? 0.8
    : currentPPE >= 25_000 ? 0.6
    : 0.3;

  const category = score >= 1.0 ? 'Very High'
    : score >= 0.9 ? 'High'
    : score >= 0.8 ? 'Medium'
    : score >= 0.6 ? 'Low'
    : 'Very Low';

  const indicators = [`${category} PPE: £${currentPPE.toLocaleString()}`];

  // PPE growth bonus
  if (previousPPE > 0) {
    const growth = (currentPPE - previousPPE) / previousPPE;
    if (growth > 0.5) {
      score = Math.min(1.0, score + 0.2);
      indicators.push(`High PPE growth: ${(growth * 100).toFixed(1)}%`);
    } else if (growth > 0.2) {
      score = Math.min(1.0, score + 0.1);
      indicators.push(`Moderate PPE growth: ${(growth * 100).toFixed(1)}%`);
    } else if (growth > 0) {
      indicators.push(`PPE growth: ${(growth * 100).toFixed(1)}%`);
    }
  }

  return { score, category, indicators };
}

// SIC Code -> 0-1 score (complete lookup table)
const SIC_SCORES: Record<string, number> = {
  '01': 0.3, '02': 0.2, '03': 0.2,
  '05': 0.6, '06': 0.7, '07': 0.6, '08': 0.6, '09': 0.6,
  // Manufacturing (10-33) = 0.9
  ...Object.fromEntries(
    Array.from({ length: 24 }, (_, i) => [String(i + 10).padStart(2, '0'), 0.9])
  ),
  '35': 0.9,
  '36': 0.8, '37': 0.8, '38': 0.8, '39': 0.8,
  '41': 0.8, '42': 0.8, '43': 0.8,
  '45': 0.7, '46': 0.6, '47': 0.8,
  '49': 0.7, '50': 0.7, '51': 0.7, '52': 0.8, '53': 0.7,
  '55': 0.9, '56': 0.9,  // Accommodation & food
  '58': 0.6, '59': 0.6, '60': 0.6, '61': 0.6, '62': 0.6, '63': 0.6,
  '64': 0.5, '65': 0.5, '66': 0.5,
  '68': 0.8,  // Real estate
  '69': 0.6, '70': 0.6, '71': 0.6, '72': 0.6, '73': 0.6, '74': 0.6, '75': 0.6,
  '77': 0.6, '78': 0.5, '79': 0.6, '80': 0.7, '81': 0.6, '82': 0.6,
  '85': 0.6,
  '86': 0.8, '87': 0.8, '88': 0.7,  // Healthcare
  '90': 0.7, '91': 0.7, '92': 0.7, '93': 0.7,
  '94': 0.6, '95': 0.6, '96': 0.6,
};

export function scoreSIC(sicCode: number | string | null): ComponentResult {
  if (!sicCode) return { score: 0.4, category: 'Unknown', indicators: ['Unknown industry'] };

  const sicString = String(sicCode);
  let prefix: string;

  if (sicString.length === 5) {
    prefix = sicString.padStart(5, '0').substring(0, 2);
  } else if (sicString.length === 4) {
    prefix = sicString.substring(0, 2);
  } else if (sicString.length === 3) {
    prefix = sicString.padStart(4, '0').substring(0, 2);
  } else {
    prefix = sicString.substring(0, 2).padStart(2, '0');
  }

  const score = SIC_SCORES[prefix] || 0.4;
  const label = score >= 0.9 ? 'Very High'
    : score >= 0.8 ? 'High'
    : score >= 0.6 ? 'Medium'
    : 'Low';

  return { score, category: label, indicators: [`${label} CA Potential Industry`] };
}

// Investment Activity -> 0-1 score (PPE growth rate)
export function scoreInvestmentActivity(currentPPE: number, previousPPE: number): ComponentResult {
  const indicators: string[] = [];

  if (!currentPPE || !previousPPE || previousPPE === 0) {
    return {
      score: 0.5,
      category: 'Unknown',
      indicators: currentPPE > 0 ? ['Existing asset base'] : [],
    };
  }

  const growth = (currentPPE - previousPPE) / previousPPE;
  const score = growth > 0.5 ? 1.0
    : growth > 0.2 ? 0.8
    : growth > 0.1 ? 0.7
    : growth > 0 ? 0.6
    : growth < -0.1 ? 0.3
    : 0.5;

  if (growth > 0.5) indicators.push(`Major recent investment: ${(growth * 100).toFixed(1)}% PPE growth`);
  else if (growth > 0.2) indicators.push(`Significant recent investment: ${(growth * 100).toFixed(1)}% PPE growth`);
  else if (growth > 0.1) indicators.push(`Moderate recent investment: ${(growth * 100).toFixed(1)}% PPE growth`);
  else if (growth > 0) indicators.push(`Recent investment activity: ${(growth * 100).toFixed(1)}% PPE growth`);
  else if (growth < -0.1) indicators.push(`Declining PPE: ${(growth * 100).toFixed(1)}% decrease`);
  else indicators.push(`PPE growth: ${(growth * 100).toFixed(1)}%`);

  return { score, category: '', indicators };
}

// Asset Intensity -> 0-1 score (PPE/Assets ratio + turnover)
export function scoreAssetIntensity(ppe: number, totalAssets: number, revenue: number): ComponentResult {
  let score = 0.5;
  const indicators: string[] = [];

  if (totalAssets > 0 && ppe) {
    const ratio = ppe / totalAssets;
    score = ratio > 0.4 ? 1.0
      : ratio > 0.25 ? 0.8
      : ratio > 0.15 ? 0.7
      : ratio > 0.05 ? 0.5
      : 0.3;
    indicators.push(`Asset intensity: ${(ratio * 100).toFixed(1)}% PPE/Assets`);
  }

  if (revenue && totalAssets > 0) {
    const turnover = revenue / totalAssets;
    if (turnover > 2.0) {
      score = Math.min(1.0, score + 0.1);
    } else if (turnover > 1.0) {
      score = Math.min(1.0, score + 0.05);
    }
  }

  return { score, category: '', indicators };
}

// Opportunity value estimation
export function estimateOpportunityValue(ppe: number, sicScore: number, intensityScore: number): string {
  if (!ppe) return 'Unknown - No PPE data';

  let embeddedPct = sicScore >= 0.9 ? 0.18
    : sicScore >= 0.8 ? 0.15
    : sicScore >= 0.6 ? 0.10
    : sicScore >= 0.3 ? 0.06
    : 0.03;

  if (intensityScore >= 0.8) embeddedPct *= 1.3;
  else if (intensityScore >= 0.6) embeddedPct *= 1.1;

  const taxRelief = ppe * embeddedPct * 0.25;

  if (taxRelief >= 100_000) return `£100k+ (Est. £${Math.round(taxRelief).toLocaleString()})`;
  if (taxRelief >= 50_000) return `£50k-100k (Est. £${Math.round(taxRelief).toLocaleString()})`;
  if (taxRelief >= 20_000) return `£20k-50k (Est. £${Math.round(taxRelief).toLocaleString()})`;
  if (taxRelief >= 5_000) return `£5k-20k (Est. £${Math.round(taxRelief).toLocaleString()})`;
  return `<£5k (Est. £${Math.round(taxRelief).toLocaleString()})`;
}

// Composite score calculation
export function calculateCapexIQScore(input: ScoringInput): ScoringResult {
  const ppeResult = scorePPE(input.currentPPE, input.previousPPE);
  const sicResult = scoreSIC(input.sicCode);
  const investResult = scoreInvestmentActivity(input.currentPPE, input.previousPPE);
  const intensityResult = scoreAssetIntensity(input.currentPPE, input.totalAssets, input.turnoverRevenue);

  const composite = (
    ppeResult.score * WEIGHTS.ppe +
    investResult.score * WEIGHTS.investmentActivity +
    intensityResult.score * WEIGHTS.assetIntensity +
    sicResult.score * WEIGHTS.sic
  );

  return {
    capexiqScore: Math.round(composite * 100),
    ppeScore: ppeResult.score,
    sicScore: sicResult.score,
    investmentActivityScore: investResult.score,
    assetIntensityScore: intensityResult.score,
    ppeCategory: ppeResult.category,
    opportunityValue: estimateOpportunityValue(input.currentPPE, sicResult.score, intensityResult.score),
    indicators: [
      ...ppeResult.indicators,
      ...sicResult.indicators,
      ...investResult.indicators,
      ...intensityResult.indicators,
    ],
  };
}
