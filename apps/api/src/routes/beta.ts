import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    feedbackStore: Array<{
      id: string;
      rating: number;
      commentary: string;
      affectedFeatures: string[];
      screenshot?: string | undefined;
      userId?: string | undefined;
      createdAt: string;
    }>;
  }
}

export async function betaRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/beta/feedback — beta users submit feedback
  app.post(
    '/v1/beta/feedback',
    { preHandler: [], schema: { body: { type: 'object', properties: { rating: { type: 'integer', minimum: 1, maximum: 5 }, commentary: { type: 'string' }, affectedFeatures: { type: 'array', items: { type: 'string' } }, screenshot: { type: 'string' } }, required: ['rating', 'commentary', 'affectedFeatures'] } } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { rating, commentary, affectedFeatures, screenshot } = req.body as {
        rating: number;
        commentary: string;
        affectedFeatures: string[];
        screenshot?: string;
      };
      const feedback = {
        id: `beta_feedback_${Date.now()}`,
        rating,
        commentary,
        affectedFeatures,
        screenshot,
        userId: req.orbitContext?.account?.id,
        createdAt: new Date().toISOString(),
      };
      app.feedbackStore.push(feedback);
      return reply.status(201).send({ data: feedback });
    }
  );

  // GET /v1/beta/feedback — beta users view their submitted feedback
  app.get(
    '/v1/beta/feedback',
    { preHandler: [] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const userId = _req.orbitContext?.account?.id;
      const feedback = (app.feedbackStore ?? []).filter(
        (f) => f.userId === userId
      );
      return reply.send({ data: feedback });
    }
  );

  // GET /v1/admin/beta/feedback — admin view of aggregate feedback
  app.get(
    '/v1/admin/beta/feedback',
    { preHandler: [] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const feedback = app.feedbackStore ?? [];

      // Calculate aggregate stats
      const totalResponses = feedback.length;
      const avgRating =
        totalResponses > 0
          ? Math.round(
              (feedback.reduce((sum: number, f: { rating: number }) => sum + f.rating, 0) / totalResponses) * 100) / 100
          : 0;

      // Top requested features
      const featureCounts: Record<string, number> = {};
      for (const f of feedback) {
        for (const feat of f.affectedFeatures ?? []) {
          featureCounts[feat] = (featureCounts[feat] ?? 0) + 1;
        }
      }
      const topFeatures = Object.entries(featureCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([name]) => name);

      // Group by rating distribution
      const ratingDist: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
      for (const f of feedback) {
        const ratingKey = String(f.rating ?? 0);
        if (Object.prototype.hasOwnProperty.call(ratingDist, ratingKey)) {
          ratingDist[ratingKey]++;
        }
      }

      return reply.send({
        data: {
          totalResponses,
          avgRating,
          ratingDistribution: ratingDist,
          topRequestedFeatures: topFeatures,
          feedbackCountByFeature: featureCounts,
        },
      });
    }
  );
}