import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { ServerContext } from '../app.js';
import { personas, projects, type PersonaIdentity, type PersonaBehavior, type PersonaKnowledge } from '../db/schema.js';

const PersonaIdentitySchema = z.object({
  fullName: z.string().min(1),
  roleLabel: z.string().min(1),
  credentials: z.object({ username: z.string(), password: z.string() }).optional(),
  signupInstructions: z.string().optional(),
  locale: z.string().min(1),
});

const PersonaBehaviorSchema = z.object({
  techSavviness: z.enum(['novice', 'average', 'expert']),
  patience: z.enum(['low', 'medium', 'high']),
  readingStyle: z.enum(['skims', 'reads']),
  device: z.enum(['desktop', 'mobile']),
  viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  habits: z.string(),
});

const PersonaKnowledgeSchema = z.object({
  productKnowledge: z.string(),
  expectations: z.string(),
  vocabulary: z.string(),
});

const CreatePersonaBody = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  identity: PersonaIdentitySchema,
  behavior: PersonaBehaviorSchema,
  knowledge: PersonaKnowledgeSchema,
  notes: z.string().optional(),
});

const UpdatePersonaBody = z.object({
  name: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  identity: PersonaIdentitySchema.partial().optional(),
  behavior: PersonaBehaviorSchema.partial().optional(),
  knowledge: PersonaKnowledgeSchema.partial().optional(),
  notes: z.string().optional(),
  archived: z.boolean().optional(),
});

export function personasRouter(ctx: ServerContext) {
  const app = new Hono();

  // POST /api/projects/:id/personas
  app.post('/api/projects/:id/personas', zValidator('json', CreatePersonaBody), (c) => {
    const projectId = c.req.param('id');
    const project = ctx.db.select().from(projects).where(eq(projects.id, projectId)).get();
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const body = c.req.valid('json');
    const id = `per_${nanoid(12)}`;
    const row = {
      id,
      projectId,
      name: body.name,
      role: body.role,
      identity: body.identity as PersonaIdentity,
      behavior: body.behavior as PersonaBehavior,
      knowledge: body.knowledge as PersonaKnowledge,
      notes: body.notes ?? null,
      archived: false,
      createdAt: new Date(),
    };
    ctx.db.insert(personas).values(row).run();
    const persona = ctx.db.select().from(personas).where(eq(personas.id, id)).get()!;
    return c.json(persona, 201);
  });

  // GET /api/projects/:id/personas
  app.get('/api/projects/:id/personas', (c) => {
    const projectId = c.req.param('id');
    const project = ctx.db.select().from(projects).where(eq(projects.id, projectId)).get();
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const result = ctx.db.select().from(personas).where(eq(personas.projectId, projectId)).all();
    return c.json(result);
  });

  // PATCH /api/personas/:id
  app.patch('/api/personas/:id', zValidator('json', UpdatePersonaBody), (c) => {
    const id = c.req.param('id');
    const persona = ctx.db.select().from(personas).where(eq(personas.id, id)).get();
    if (!persona) return c.json({ error: 'Persona not found' }, 404);

    const body = c.req.valid('json');
    const updates: Partial<typeof personas.$inferInsert> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.role !== undefined) updates.role = body.role;
    if (body.identity !== undefined) updates.identity = { ...persona.identity, ...body.identity } as typeof persona.identity;
    if (body.behavior !== undefined) updates.behavior = { ...persona.behavior, ...body.behavior } as typeof persona.behavior;
    if (body.knowledge !== undefined) updates.knowledge = { ...persona.knowledge, ...body.knowledge } as typeof persona.knowledge;
    if (body.notes !== undefined) updates.notes = body.notes;
    if (body.archived !== undefined) updates.archived = body.archived;

    ctx.db.update(personas).set(updates).where(eq(personas.id, id)).run();
    const updated = ctx.db.select().from(personas).where(eq(personas.id, id)).get()!;
    return c.json(updated);
  });

  return app;
}
