import { completeJSON } from '../services/openrouter.js';
import { getActivePrompt } from '../db/prompts.js';
import { getSetting } from '../db/settings.js';

export interface CAAnalysis {
  company_analysis: {
    company_name: string;
    company_number: string;
    incorporation_date: string;
    primary_sic_code: number;
    sic_description: string;
    business_model_type: string;
  };
  asset_analysis: {
    current_year: {
      primary_assets: number;
      investment_property: number;
      total_assets: number;
      asset_composition_score: number;
    };
    investment_activity: {
      asset_growth_rate: string;
      major_investment_indicator: boolean;
      investment_timing: string;
      activity_score: number;
    };
  };
  legal_qualification: {
    qualifying_activity_present: boolean;
    asset_ownership_confirmed: boolean;
    recent_expenditure_evidence: boolean;
    legal_barriers: string[];
    qualification_confidence: number;
  };
  embedded_ca_assessment: {
    overall_score: number;
    detailed_scoring: {
      asset_scale_quality: number;
      industry_alignment: number;
      investment_activity: number;
      business_model_fit: number;
      legal_qualification: number;
    };
    opportunity_estimation: {
      likely_embedded_ca_range: string;
      potential_tax_relief_range: string;
      confidence_level: string;
      basis_for_estimate: string;
    };
    recommendation: string;
  };
  detailed_findings: {
    key_positive_indicators: string[];
    risk_factors: string[];
    data_quality_notes: string[];
    next_steps: string;
    specialist_review_required: boolean;
  };
}

export interface CompanyForValidation {
  companyName: string;
  companyNumber: string;
  incorporationDate?: string;
  sicCode?: number | string | null;
  sicDescription?: string;
  location?: string;
  companyStatus?: string;
  financials: Record<string, any>;
  extracted: {
    currentPPE: number;
    previousPPE: number;
    investmentProperty: number;
    turnoverRevenue: number;
  };
}

export async function validateCA(
  company: CompanyForValidation,
  apiKey: string
): Promise<{ analysis: CAAnalysis; promptVersionId: number | null }> {
  const model = await getSetting('model_ca_analysis') || 'moonshotai/kimi-k2.5';

  // Load prompts from DB
  const systemPrompt = await getActivePrompt('ca_analysis_system');
  const userPromptTemplate = await getActivePrompt('ca_analysis_user');

  const defaultSystem = `You are a senior financial analyst with 15+ years of experience specializing in UK Embedded Capital Allowances and HMRC compliance. You are analyzing pre-structured financial data from company filings to identify embedded capital allowances opportunities.

CRITICAL INSTRUCTIONS:
- Return ONLY a valid JSON object with your analysis
- Calculate embedded CA potential based on property investments and asset values
- Include confidence scores for all assessments
- Flag any data quality issues or missing information
- Focus on investment property, PPE, and recent capital expenditure patterns`;

  const currentBS = company.financials?.balanceSheet?.currentYear || {};
  const previousBS = company.financials?.balanceSheet?.previousYear || {};
  const growth = company.financials;

  const defaultUser = `Analyze the following pre-structured financial data for a UK company and assess its embedded capital allowances opportunity.

Company Details:
Company Name: ${company.companyName}
Company Number: ${company.companyNumber}
Incorporation Date: ${company.incorporationDate || 'Unknown'}
Industry: ${company.sicDescription || 'Unknown'} (SIC: ${company.sicCode || 'Unknown'})
Location: ${company.location || 'Unknown'}
Company Status: ${company.companyStatus || 'Unknown'}

Current Year Financials:
Total Assets: ${currentBS.calculatedTotalAssets || 0}
Fixed Assets: ${currentBS.calculatedTotalFixedAssets || 0}
Current Assets: ${currentBS.calculatedTotalCurrentAssets || 0}
Total Liabilities: ${currentBS.calculatedTotalLiabilities || 0}
Equity: ${currentBS.calculatedEquity || 0}
Debt to Equity Ratio: ${currentBS.debtToEquityRatio || growth?.cDebtToEquityRatio || 0}
Debt to Asset Ratio: ${currentBS.debtToAssetRatio || growth?.cDebtToAssetRatio || 0}

Previous Year Financials:
Total Assets: ${previousBS.calculatedTotalAssets || 0}
Fixed Assets: ${previousBS.calculatedTotalFixedAssets || 0}
Current Assets: ${previousBS.calculatedTotalCurrentAssets || 0}
Total Liabilities: ${previousBS.calculatedTotalLiabilities || 0}
Equity: ${previousBS.calculatedEquity || 0}
Debt to Equity Ratio: ${previousBS.debtToEquityRatio || growth?.pDebtToEquityRatio || 0}
Debt to Asset Ratio: ${previousBS.debtToAssetRatio || growth?.pDebtToAssetRatio || 0}

Growth Indicators:
Assets Growth Rate: ${growth?.assetsGrowthRate || 0}
Net Assets Growth Rate: ${growth?.netAssetsGrowthRate || 0}

Extracted PPE Data:
Current PPE: ${company.extracted.currentPPE}
Previous PPE: ${company.extracted.previousPPE}
Investment Property: ${company.extracted.investmentProperty}
Turnover Revenue: ${company.extracted.turnoverRevenue}

Return your analysis as a structured JSON object.`;

  const analysis = await completeJSON<CAAnalysis>({
    model,
    systemPrompt: systemPrompt?.content || defaultSystem,
    userPrompt: userPromptTemplate?.content || defaultUser,
    apiKey,
  });

  return {
    analysis,
    promptVersionId: systemPrompt?.id || null,
  };
}
