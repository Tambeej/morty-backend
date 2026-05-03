/**
 * Tests for wizardValidator – Joi schema and business rule validation.
 */

'use strict';

const { wizardSubmitSchema, validateBusinessRules } = require('../src/validators/wizardValidator');

// ── Test Data ─────────────────────────────────────────────────────────────────

const VALID_BODY = {
  inputs: {
    propertyPrice: 2000000,
    loanAmount: 1500000,
    monthlyIncome: 25000,
    additionalIncome: 5000,
    targetRepayment: 7000,
    futureFunds: { timeframe: 'none', amount: 0 },
    stabilityPreference: 5,
  },
  consent: true,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('wizardSubmitSchema', () => {
  it('should validate a correct payload', () => {
    const { error } = wizardSubmitSchema.validate(VALID_BODY);
    expect(error).toBeUndefined();
  });

  it('should reject missing inputs', () => {
    const { error } = wizardSubmitSchema.validate({ consent: true });
    expect(error).toBeTruthy();
  });

  it('should reject missing consent', () => {
    const { error } = wizardSubmitSchema.validate({ inputs: VALID_BODY.inputs });
    expect(error).toBeTruthy();
  });

  it('should reject propertyPrice below 100000', () => {
    const body = {
      ...VALID_BODY,
      inputs: { ...VALID_BODY.inputs, propertyPrice: 50000 },
    };
    const { error } = wizardSubmitSchema.validate(body);
    expect(error).toBeTruthy();
    expect(error.details[0].path).toContain('propertyPrice');
  });

  it('should reject propertyPrice above 50000000', () => {
    const body = {
      ...VALID_BODY,
      inputs: { ...VALID_BODY.inputs, propertyPrice: 60000000 },
    };
    const { error } = wizardSubmitSchema.validate(body);
    expect(error).toBeTruthy();
  });

  it('should reject loanAmount below 50000', () => {
    const body = {
      ...VALID_BODY,
      inputs: { ...VALID_BODY.inputs, loanAmount: 10000 },
    };
    const { error } = wizardSubmitSchema.validate(body);
    expect(error).toBeTruthy();
  });

  it('should reject monthlyIncome below 1000', () => {
    const body = {
      ...VALID_BODY,
      inputs: { ...VALID_BODY.inputs, monthlyIncome: 500 },
    };
    const { error } = wizardSubmitSchema.validate(body);
    expect(error).toBeTruthy();
  });

  it('should reject targetRepayment below 500', () => {
    const body = {
      ...VALID_BODY,
      inputs: { ...VALID_BODY.inputs, targetRepayment: 100 },
    };
    const { error } = wizardSubmitSchema.validate(body);
    expect(error).toBeTruthy();
  });

  it('should reject stabilityPreference below 1', () => {
    const body = {
      ...VALID_BODY,
      inputs: { ...VALID_BODY.inputs, stabilityPreference: 0 },
    };
    const { error } = wizardSubmitSchema.validate(body);
    expect(error).toBeTruthy();
  });

  it('should reject stabilityPreference above 10', () => {
    const body = {
      ...VALID_BODY,
      inputs: { ...VALID_BODY.inputs, stabilityPreference: 11 },
    };
    const { error } = wizardSubmitSchema.validate(body);
    expect(error).toBeTruthy();
  });

  it('should reject non-integer stabilityPreference', () => {
    const body = {
      ...VALID_BODY,
      inputs: { ...VALID_BODY.inputs, stabilityPreference: 5.5 },
    };
    const { error } = wizardSubmitSchema.validate(body);
    expect(error).toBeTruthy();
  });

  it('should reject invalid futureFunds timeframe', () => {
    const body = {
      ...VALID_BODY,
      inputs: {
        ...VALID_BODY.inputs,
        futureFunds: { timeframe: 'tomorrow', amount: 0 },
      },
    };
    const { error } = wizardSubmitSchema.validate(body);
    expect(error).toBeTruthy();
  });

  it('should accept all valid futureFunds timeframes', () => {
    const timeframes = ['none', 'within_5_years', 'within_10_years', 'over_10_years'];

    for (const timeframe of timeframes) {
      const body = {
        ...VALID_BODY,
        inputs: {
          ...VALID_BODY.inputs,
          futureFunds: { timeframe, amount: 100000 },
        },
      };
      const { error } = wizardSubmitSchema.validate(body);
      expect(error).toBeUndefined();
    }
  });

  it('should default additionalIncome to 0 when not provided', () => {
    const inputs = { ...VALID_BODY.inputs };
    delete inputs.additionalIncome;
    const body = { inputs, consent: true };

    const { error, value } = wizardSubmitSchema.validate(body);
    expect(error).toBeUndefined();
    expect(value.inputs.additionalIncome).toBe(0);
  });

  it('should strip unknown fields', () => {
    const body = {
      ...VALID_BODY,
      inputs: { ...VALID_BODY.inputs, unknownField: 'test' },
    };
    const { error, value } = wizardSubmitSchema.validate(body, {
      stripUnknown: true,
      allowUnknown: false,
    });
    // Joi with stripUnknown should remove unknown fields
    expect(value.inputs).not.toHaveProperty('unknownField');
  });

  it('should reject consent as non-boolean', () => {
    const body = { ...VALID_BODY, consent: 'yes' };
    const { error } = wizardSubmitSchema.validate(body);
    expect(error).toBeTruthy();
  });

  it('should accept consent=false', () => {
    const body = { ...VALID_BODY, consent: false };
    const { error } = wizardSubmitSchema.validate(body);
    expect(error).toBeUndefined();
  });
});

describe('validateBusinessRules', () => {
  it('should pass for valid inputs', () => {
    const result = validateBusinessRules(VALID_BODY.inputs);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail when loanAmount exceeds propertyPrice', () => {
    const inputs = { ...VALID_BODY.inputs, loanAmount: 2500000 };
    const result = validateBusinessRules(inputs);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Loan amount cannot exceed property price');
  });

  it('should fail when targetRepayment exceeds 80% of total income', () => {
    const inputs = {
      ...VALID_BODY.inputs,
      monthlyIncome: 10000,
      additionalIncome: 0,
      targetRepayment: 9000,
    };
    const result = validateBusinessRules(inputs);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('80%'))).toBe(true);
  });

  it('should pass when targetRepayment is exactly 80% of income', () => {
    const inputs = {
      ...VALID_BODY.inputs,
      monthlyIncome: 10000,
      additionalIncome: 0,
      targetRepayment: 8000,
    };
    const result = validateBusinessRules(inputs);
    expect(result.valid).toBe(true);
  });

  it('should pass when loanAmount equals propertyPrice', () => {
    const inputs = {
      ...VALID_BODY.inputs,
      propertyPrice: 1500000,
      loanAmount: 1500000,
    };
    const result = validateBusinessRules(inputs);
    expect(result.valid).toBe(true);
  });

  it('should consider additionalIncome in repayment ratio', () => {
    const inputs = {
      ...VALID_BODY.inputs,
      monthlyIncome: 10000,
      additionalIncome: 5000,
      targetRepayment: 11000, // 73% of 15000 total
    };
    const result = validateBusinessRules(inputs);
    expect(result.valid).toBe(true);
  });
});
