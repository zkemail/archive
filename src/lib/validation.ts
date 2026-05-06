import { z } from 'zod';

export const domainSchema = z
  .string()
  .min(1, 'domain is required')
  .max(253)
  .regex(
    /^(?!-)[a-zA-Z0-9-]{1,63}(?<!-)(\.[a-zA-Z0-9-]{1,63})*$/,
    'invalid domain format'
  );

export const selectorSchema = z
  .string()
  .min(1, 'selector is required')
  .max(63)
  .regex(/^[a-zA-Z0-9_-]+$/, 'invalid selector format');

// Optional selector (for routes where it's not required)
export const optionalSelectorSchema = selectorSchema.optional();

// Pre-composed query schema for GET routes
export const dspQuerySchema = z.object({
  domain: domainSchema,
  selector: optionalSelectorSchema,
});

// Body schema for POST routes
export const dspBodySchema = z.object({
  domain: domainSchema,
  selector: selectorSchema,
});

// Type exports
export type DspQuery = z.infer<typeof dspQuerySchema>;
export type DspBody = z.infer<typeof dspBodySchema>;
