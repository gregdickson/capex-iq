import { getCompanyFinancials, extractFinancials, type DataLedgerResponse } from '../services/dataledger.js';
import { calculateCapexIQScore, type ScoringResult } from './scoring.js';
import { validateCA, type CAAnalysis } from './ai-validation.js';
import { getSettingNumber } from '../db/settings.js';

export interface QualificationResult {
  financials: DataLedgerResponse | null;
  extracted: {
    currentPPE: number;
    previousPPE: number;
    totalAssets: number;
    turnoverRevenue: number;
    investmentProperty: number;
    sicCode: number | null;
  };
  scoring: ScoringResult;
  caAnalysis: CAAnalysis | null;
  promptVersionId: number | null;
  companyName: string;
  companyNumber: string;
  incorporationDate: string | null;
  sicDescription: string | null;
  location: string | null;
  companyStatus: string | null;
  financialsError: boolean;
}

export async function qualifyCompany(
  companyNumber: string,
  orgName: string,
  env: { DATALEDGER_API_KEY: string; OPENROUTER_API_KEY: string }
): Promise<QualificationResult> {
  // Step 1: Fetch financials from DataLedger
  const financials = await getCompanyFinancials(companyNumber, env.DATALEDGER_API_KEY);

  if (!financials) {
    // No financials found — score with zeros
    const scoring = calculateCapexIQScore({
      currentPPE: 0,
      previousPPE: 0,
      totalAssets: 0,
      turnoverRevenue: 0,
      sicCode: null,
    });

    return {
      financials: null,
      extracted: { currentPPE: 0, previousPPE: 0, totalAssets: 0, turnoverRevenue: 0, investmentProperty: 0, sicCode: null },
      scoring,
      caAnalysis: null,
      promptVersionId: null,
      companyName: orgName,
      companyNumber,
      incorporationDate: null,
      sicDescription: null,
      location: null,
      companyStatus: null,
      financialsError: true,
    };
  }

  // Step 2: Extract key financial fields
  const extracted = extractFinancials(financials);

  // Step 3: Run scoring engine
  const scoring = calculateCapexIQScore({
    currentPPE: extracted.currentPPE,
    previousPPE: extracted.previousPPE,
    totalAssets: extracted.totalAssets,
    turnoverRevenue: extracted.turnoverRevenue,
    sicCode: extracted.sicCode,
  });

  // Step 4: Conditional AI validation
  const threshold = await getSettingNumber('ai_validation_threshold', 55);
  let caAnalysis: CAAnalysis | null = null;
  let promptVersionId: number | null = null;

  if (scoring.capexiqScore > threshold) {
    const location = [
      financials.registeredAddress?.localAuthority,
      financials.countryOfOrigin,
    ].filter(Boolean).join(', ');

    const result = await validateCA(
      {
        companyName: financials.companyName || orgName,
        companyNumber: financials.companyNumber || companyNumber,
        incorporationDate: financials.incorporationDate,
        sicCode: financials.industry?.sic1,
        sicDescription: financials.industry?.sic1Description,
        location,
        companyStatus: financials.isActive ? 'active' : 'inactive',
        financials: financials.financials || {},
        extracted: {
          currentPPE: extracted.currentPPE,
          previousPPE: extracted.previousPPE,
          investmentProperty: extracted.investmentProperty,
          turnoverRevenue: extracted.turnoverRevenue,
        },
      },
      env.OPENROUTER_API_KEY
    );

    caAnalysis = result.analysis;
    promptVersionId = result.promptVersionId;
  }

  return {
    financials,
    extracted,
    scoring,
    caAnalysis,
    promptVersionId,
    companyName: financials.companyName || orgName,
    companyNumber: financials.companyNumber || companyNumber,
    incorporationDate: financials.incorporationDate || null,
    sicDescription: financials.industry?.sic1Description || null,
    location: [financials.registeredAddress?.localAuthority, financials.countryOfOrigin].filter(Boolean).join(', ') || null,
    companyStatus: financials.isActive ? 'active' : 'inactive',
    financialsError: false,
  };
}
