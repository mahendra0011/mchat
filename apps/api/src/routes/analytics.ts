import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { resolveRequestContext, resolveTeamRole } from '../auth.js';
import { can } from '@orbit/domain';
import { store } from '../store.js';
import { eventRegistry } from '../event-registry.js';
import { ExperimentDefinitionSchema, ResearchStudySchema, ResearchPoolSchema } from '@orbit/schemas';

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  // Event Registry API
  app.get('/v1/analytics/events', { preHandler: [resolveRequestContext] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = req.orbitContext!;
    const role = resolveTeamRole(ctx);
    if (!role || !can(role, 'audit.view')) {
      return reply.status(403).send({
        error: { code: 'INSUFFICIENT_CAPABILITY', message: 'Requires audit.view', requestId: req.id },
      });
    }
    const events = eventRegistry.list();
    return reply.send({ data: events.map(e => e.definition) });
  });

  app.get('/v1/analytics/events/:name', { preHandler: [resolveRequestContext] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = req.orbitContext!;
    const role = resolveTeamRole(ctx);
    if (!role || !can(role, 'audit.view')) {
      return reply.status(403).send({
        error: { code: 'INSUFFICIENT_CAPABILITY', message: 'Requires audit.view', requestId: req.id },
      });
    }
    const { name } = req.params as { name: string };
    const entry = eventRegistry.get(name);
    if (!entry) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Event not found' } });
    }
    return reply.send({ data: entry.definition });
  });

  app.post('/v1/admin/analytics/events', { preHandler: [resolveRequestContext] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = req.orbitContext!;
    const role = resolveTeamRole(ctx);
    if (!role || !can(role, 'audit.view' as any)) {
      return reply.status(403).send({
        error: { code: 'INSUFFICIENT_CAPABILITY', message: 'Requires system_admin', requestId: req.id },
      });
    }
    const result = eventRegistry.register(req.body as any);
    if (!result.success) {
      return reply.status(400).send({ error: { code: 'INVALID_EVENT', message: result.error } });
    }
    return reply.status(201).send({ success: true });
  });

  // Metrics Collection API
  app.post('/v1/telemetry/metrics', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name, properties } = req.body as { name: string; properties: Record<string, unknown> };
    if (!name || !properties) {
      return reply.status(400).send({ error: { code: 'INVALID_METRIC', message: 'name and properties required' } });
    }
    const entry = eventRegistry.get(name);
    if (!entry) {
      return reply.status(404).send({ error: { code: 'EVENT_NOT_REGISTERED', message: `Metric ${name} not registered` } });
    }
    const validation = eventRegistry.validate(name, properties);
    if (!validation.valid) {
      return reply.status(400).send({ error: { code: 'VALIDATION_FAILED', message: validation.errors.join(', ') } });
    }
    eventRegistry.incrementCount(name);
    await store.persistTelemetryEvent({
      eventId: `met_${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      eventName: name,
      occurredAt: new Date().toISOString(),
      actorType: 'system',
      anonymizedCategory: 'metric',
      clientPlatform: 'api',
    } as any);
    return reply.status(202).send({ success: true });
  });

  app.get('/v1/analytics/metrics/summary', { preHandler: [resolveRequestContext] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = req.orbitContext!;
    const role = resolveTeamRole(ctx);
    if (!role || !can(role, 'audit.view')) {
      return reply.status(403).send({
        error: { code: 'INSUFFICIENT_CAPABILITY', message: 'Requires audit.view', requestId: req.id },
      });
    }
    const events = eventRegistry.list();
    const summary = events.map(e => ({
      name: e.definition.name,
      count: e.eventCount,
      lastSeenAt: e.lastSeenAt,
      purpose: e.definition.purpose,
      retentionDays: e.definition.retentionDays,
    }));
    return reply.send({ data: summary });
  });

  // Experiments API
  app.post('/v1/admin/experiments', { preHandler: [resolveRequestContext] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = req.orbitContext!;
    const role = resolveTeamRole(ctx);
    if (!role || !can(role, 'audit.view' as any)) {
      return reply.status(403).send({
        error: { code: 'INSUFFICIENT_CAPABILITY', message: 'Requires system_admin', requestId: req.id },
      });
    }
    const parseResult = ExperimentDefinitionSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: { code: 'INVALID_EXPERIMENT', message: parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ') },
      });
    }
    const experiment = parseResult.data;
    store.experiments.set(experiment.id, experiment);
    await store.persistExperiment(experiment);
    return reply.status(201).send({ data: experiment });
  });

  app.get('/v1/admin/experiments', { preHandler: [resolveRequestContext] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = req.orbitContext!;
    const role = resolveTeamRole(ctx);
    if (!role || !can(role, 'audit.view')) {
      return reply.status(403).send({
        error: { code: 'INSUFFICIENT_CAPABILITY', message: 'Requires audit.view', requestId: req.id },
      });
    }
    const experiments = Array.from(store.experiments.values());
    return reply.send({ data: experiments });
  });

  app.post('/v1/admin/experiments/:id/start', { preHandler: [resolveRequestContext] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = req.orbitContext!;
    const role = resolveTeamRole(ctx);
    if (!role || !can(role, 'audit.view' as any)) {
      return reply.status(403).send({
        error: { code: 'INSUFFICIENT_CAPABILITY', message: 'Requires system_admin', requestId: req.id },
      });
    }
    const { id } = req.params as { id: string };
    const experiment = store.experiments.get(id);
    if (!experiment) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Experiment not found' } });
    }
    experiment.status = 'running';
    experiment.startDate = new Date().toISOString();
    experiment.updatedAt = new Date().toISOString();
    store.experiments.set(id, experiment);
    await store.persistExperiment(experiment);
    return reply.send({ data: experiment });
  });

  app.post('/v1/admin/experiments/:id/stop', { preHandler: [resolveRequestContext] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = req.orbitContext!;
    const role = resolveTeamRole(ctx);
    if (!role || !can(role, 'audit.view' as any)) {
      return reply.status(403).send({
        error: { code: 'INSUFFICIENT_CAPABILITY', message: 'Requires system_admin', requestId: req.id },
      });
    }
    const { id } = req.params as { id: string };
    const experiment = store.experiments.get(id);
    if (!experiment) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Experiment not found' } });
    }
    experiment.status = 'completed';
    experiment.endDate = new Date().toISOString();
    experiment.updatedAt = new Date().toISOString();
    store.experiments.set(id, experiment);
    await store.persistExperiment(experiment);
    return reply.send({ data: experiment });
  });

  app.get('/v1/experiments/assignments', { preHandler: [resolveRequestContext] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = req.orbitContext!;
    const accountId = ctx.account.id;
    const activeWorkspaceId = ctx.activeWorkspace.id;
    const now = new Date();
    const activeExperiments = Array.from(store.experiments.values()).filter(exp => {
      if (exp.status !== 'running') return false;
      if (exp.startDate && new Date(exp.startDate) > now) return false;
      if (exp.endDate && new Date(exp.endDate) < now) return false;
      return true;
    });
    const assignments = await Promise.all(activeExperiments.map(async (exp) => {
      const { assignVariant } = await import('@orbit/domain');
      const unitId = exp.randomizationUnit === 'account' ? accountId : activeWorkspaceId;
      const variant = assignVariant({ accountId, workspaceId: activeWorkspaceId }, exp);
      const assignmentId = `asg_${exp.id}_${unitId}`;
      let assignment = store.experimentAssignments.get(assignmentId);
      if (!assignment) {
        assignment = {
          id: assignmentId,
          experimentId: exp.id,
          unitId,
          unitType: exp.randomizationUnit,
          variant,
          assignedAt: new Date().toISOString(),
        };
        store.experimentAssignments.set(assignmentId, assignment);
        await store.persistExperimentAssignment(assignment);
      }
      return { experimentId: exp.id, variant: assignment.variant, hypothesis: exp.hypothesis };
    }));
    return reply.send({ data: assignments });
  });

  // Research Studies API
  app.post('/v1/research/studies', { preHandler: [resolveRequestContext] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = req.orbitContext!;
    const role = resolveTeamRole(ctx);
    if (!role || !can(role, 'audit.view' as any)) {
      return reply.status(403).send({
        error: { code: 'INSUFFICIENT_CAPABILITY', message: 'Requires system_admin', requestId: req.id },
      });
    }
    const parseResult = ResearchStudySchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: { code: 'INVALID_STUDY', message: parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ') },
      });
    }
    const study = parseResult.data;
    store.researchStudies.set(study.id, study);
    await store.persistResearchStudy(study);
    return reply.status(201).send({ data: study });
  });

  app.post('/v1/research/studies/:id/recruit', { preHandler: [resolveRequestContext] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = req.orbitContext!;
    const role = resolveTeamRole(ctx);
    if (!role || !can(role, 'audit.view' as any)) {
      return reply.status(403).send({
        error: { code: 'INSUFFICIENT_CAPABILITY', message: 'Requires system_admin', requestId: req.id },
      });
    }
    const { id } = req.params as { id: string };
    const study = store.researchStudies.get(id);
    if (!study) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Study not found' } });
    }
    const { userId, consentedAt } = req.body as { userId: string; consentedAt: string };
    const participantId = `part_${id}_${userId}`;
    const participant = {
      id: participantId,
      studyId: id,
      userId,
      consentedAt,
      status: 'consented' as const,
      createdAt: new Date().toISOString(),
    };
    store.researchParticipants.set(participantId, participant);
    await store.persistResearchParticipant(participant);
    return reply.status(201).send({ data: participant });
  });

  app.post('/v1/research/pools', { preHandler: [resolveRequestContext] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = req.orbitContext!;
    const role = resolveTeamRole(ctx);
    if (!role || !can(role, 'audit.view' as any)) {
      return reply.status(403).send({
        error: { code: 'INSUFFICIENT_CAPABILITY', message: 'Requires system_admin', requestId: req.id },
      });
    }
    const parseResult = ResearchPoolSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: { code: 'INVALID_POOL', message: parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ') },
      });
    }
    const pool = parseResult.data;
    store.researchPools.set(pool.id, pool);
    await store.persistResearchPool(pool);
    return reply.status(201).send({ data: pool });
  });
}