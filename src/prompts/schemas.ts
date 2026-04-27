// Structured output schemas for OpenRouter LLM calls
// These are used with response_format: { type: "json_schema", json_schema: ... }

export const EMAIL_SEQUENCE_SCHEMA = {
  name: 'email_sequence',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      email_sequence: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            email_number: { type: 'number', description: '1-5' },
            subject: { type: 'string', description: '5-8 words, no clickbait' },
            preheader: {
              type: 'string',
              description: '40-100 characters. Preview text shown after subject line in email clients. Should complement the subject, not repeat it.',
            },
            body: { type: 'string', description: '80-150 words, UK English, no sign-off' },
            send_delay_days: { type: 'number', description: 'Days after Day 0' },
            purpose: { type: 'string', description: 'The strategic purpose of this email' },
          },
          required: ['email_number', 'subject', 'preheader', 'body', 'send_delay_days', 'purpose'],
          additionalProperties: false,
        },
        minItems: 5,
        maxItems: 5,
      },
    },
    required: ['email_sequence'],
    additionalProperties: false,
  },
} as const;

export const CA_ANALYSIS_SCHEMA = {
  name: 'ca_analysis',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      company_analysis: {
        type: 'object',
        properties: {
          company_name: { type: 'string' },
          company_number: { type: 'string' },
          incorporation_date: { type: 'string' },
          primary_sic_code: { type: 'number' },
          sic_description: { type: 'string' },
          business_model_type: { type: 'string' },
        },
        required: ['company_name', 'company_number', 'incorporation_date', 'primary_sic_code', 'sic_description', 'business_model_type'],
        additionalProperties: false,
      },
      asset_analysis: {
        type: 'object',
        properties: {
          current_year: {
            type: 'object',
            properties: {
              primary_assets: { type: 'number' },
              investment_property: { type: 'number' },
              total_assets: { type: 'number' },
              asset_composition_score: { type: 'number' },
            },
            required: ['primary_assets', 'investment_property', 'total_assets', 'asset_composition_score'],
            additionalProperties: false,
          },
          investment_activity: {
            type: 'object',
            properties: {
              asset_growth_rate: { type: 'string' },
              major_investment_indicator: { type: 'boolean' },
              investment_timing: { type: 'string' },
              activity_score: { type: 'number' },
            },
            required: ['asset_growth_rate', 'major_investment_indicator', 'investment_timing', 'activity_score'],
            additionalProperties: false,
          },
        },
        required: ['current_year', 'investment_activity'],
        additionalProperties: false,
      },
      legal_qualification: {
        type: 'object',
        properties: {
          qualifying_activity_present: { type: 'boolean' },
          asset_ownership_confirmed: { type: 'boolean' },
          recent_expenditure_evidence: { type: 'boolean' },
          legal_barriers: { type: 'array', items: { type: 'string' } },
          qualification_confidence: { type: 'number' },
        },
        required: ['qualifying_activity_present', 'asset_ownership_confirmed', 'recent_expenditure_evidence', 'legal_barriers', 'qualification_confidence'],
        additionalProperties: false,
      },
      embedded_ca_assessment: {
        type: 'object',
        properties: {
          overall_score: { type: 'number' },
          detailed_scoring: {
            type: 'object',
            properties: {
              asset_scale_quality: { type: 'number' },
              industry_alignment: { type: 'number' },
              investment_activity: { type: 'number' },
              business_model_fit: { type: 'number' },
              legal_qualification: { type: 'number' },
            },
            required: ['asset_scale_quality', 'industry_alignment', 'investment_activity', 'business_model_fit', 'legal_qualification'],
            additionalProperties: false,
          },
          opportunity_estimation: {
            type: 'object',
            properties: {
              likely_embedded_ca_range: { type: 'string' },
              potential_tax_relief_range: { type: 'string' },
              confidence_level: { type: 'string' },
              basis_for_estimate: { type: 'string' },
            },
            required: ['likely_embedded_ca_range', 'potential_tax_relief_range', 'confidence_level', 'basis_for_estimate'],
            additionalProperties: false,
          },
          recommendation: { type: 'string', description: 'HIGH_PRIORITY | INVESTIGATE_FURTHER | LOW_PRIORITY' },
        },
        required: ['overall_score', 'detailed_scoring', 'opportunity_estimation', 'recommendation'],
        additionalProperties: false,
      },
      detailed_findings: {
        type: 'object',
        properties: {
          key_positive_indicators: { type: 'array', items: { type: 'string' } },
          risk_factors: { type: 'array', items: { type: 'string' } },
          data_quality_notes: { type: 'array', items: { type: 'string' } },
          next_steps: { type: 'string' },
          specialist_review_required: { type: 'boolean' },
        },
        required: ['key_positive_indicators', 'risk_factors', 'data_quality_notes', 'next_steps', 'specialist_review_required'],
        additionalProperties: false,
      },
    },
    required: ['company_analysis', 'asset_analysis', 'legal_qualification', 'embedded_ca_assessment', 'detailed_findings'],
    additionalProperties: false,
  },
} as const;
