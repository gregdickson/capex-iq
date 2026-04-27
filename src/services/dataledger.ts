export interface DataLedgerResponse {
  companyNumber?: string;
  companyName?: string;
  isActive?: boolean;
  incorporationDate?: string;
  registeredAddress?: {
    address?: string;
    postcode?: string;
    localAuthority?: string;
  };
  countryOfOrigin?: string;
  industry?: {
    sic1?: number;
    sic1Description?: string;
    sic2?: number | null;
    sic2Description?: string | null;
  };
  financials?: {
    balanceSheet?: {
      currentYear?: Record<string, any>;
      previousYear?: Record<string, any>;
    };
    profitAndLoss?: {
      currentYear?: Record<string, any>;
    };
    assetsGrowthRate?: number;
    netAssetsGrowthRate?: number;
    [key: string]: any;
  };
}

export interface ExtractedFinancials {
  currentPPE: number;
  previousPPE: number;
  totalAssets: number;
  turnoverRevenue: number;
  investmentProperty: number;
  sicCode: number | null;
  error: boolean;
}

export async function getCompanyFinancials(
  companyNumber: string,
  apiKey: string
): Promise<DataLedgerResponse | null> {
  const url = `https://api.dataledger.uk/v1/companies/${companyNumber}`;

  const response = await fetch(url, {
    headers: { 'x-api-key': apiKey },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`DataLedger API error: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as DataLedgerResponse;
}

export function extractFinancials(data: DataLedgerResponse): ExtractedFinancials {
  const currentBS = data.financials?.balanceSheet?.currentYear || {};
  const previousBS = data.financials?.balanceSheet?.previousYear || {};
  const currentPL = data.financials?.profitAndLoss?.currentYear || {};

  // PPE with fallback chain: propertyPlantEquipment → investmentProperty → calculatedTotalFixedAssets
  const currentPPE =
    currentBS.propertyPlantEquipment ||
    currentBS.investmentProperty ||
    currentBS.calculatedTotalFixedAssets ||
    0;

  const previousPPE =
    previousBS.propertyPlantEquipment ||
    previousBS.investmentProperty ||
    previousBS.calculatedTotalFixedAssets ||
    0;

  return {
    currentPPE,
    previousPPE,
    totalAssets: currentBS.calculatedTotalAssets || 0,
    turnoverRevenue: currentPL.turnoverRevenue || 0,
    investmentProperty: currentBS.investmentProperty || 0,
    sicCode: data.industry?.sic1 || null,
    error: false,
  };
}
