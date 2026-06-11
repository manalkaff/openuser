import { z } from 'zod';

// PersonaIdentity — contracts §5
export const PersonaIdentitySchema = z.object({
  fullName: z.string(),
  roleLabel: z.string(),
  credentials: z
    .object({
      username: z.string(),
      password: z.string(),
    })
    .optional(),
  signupInstructions: z.string().optional(),
  locale: z.string(),
});
export type PersonaIdentity = z.infer<typeof PersonaIdentitySchema>;

// PersonaBehavior — contracts §5
export const PersonaBehaviorSchema = z.object({
  techSavviness: z.enum(['novice', 'average', 'expert']),
  patience: z.enum(['low', 'medium', 'high']),
  readingStyle: z.enum(['skims', 'reads']),
  device: z.enum(['desktop', 'mobile']),
  viewport: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  habits: z.string(),
});
export type PersonaBehavior = z.infer<typeof PersonaBehaviorSchema>;

// PersonaKnowledge — contracts §5
export const PersonaKnowledgeSchema = z.object({
  productKnowledge: z.string(),
  expectations: z.string(),
  vocabulary: z.string(),
});
export type PersonaKnowledge = z.infer<typeof PersonaKnowledgeSchema>;
