import SearchLog from '../models/SearchLog.js';

/**
 * POST /api/search-logs
 * Public (optionally authenticated via maybeAuth).
 * Records a user search query. Fire-and-forget from the client.
 */
export const logSearch = async (req, res) => {
  try {
    const { query, source, resultsCount } = req.body;
    if (!query || !String(query).trim()) {
      return res.status(400).json({ message: 'query is required' });
    }
    const log = new SearchLog({
      query: String(query).trim().slice(0, 200),
      source: ['web', 'web-header', 'web-modal', 'mobile'].includes(source) ? source : 'web',
      resultsCount: typeof resultsCount === 'number' && resultsCount >= 0 ? Math.round(resultsCount) : 0,
      userId: req.user?._id || null,
    });
    await log.save();
    return res.status(201).json({ ok: true });
  } catch (error) {
    console.error('logSearch error:', error);
    return res.status(500).json({ message: 'Failed to save search log' });
  }
};

/**
 * GET /api/search-logs
 * Admin only. Returns paginated list + top query aggregation.
 */
export const getSearchLogs = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const source = req.query.source || '';
    const search = req.query.search ? String(req.query.search).trim() : '';

    const filter = {};
    if (source && ['web', 'web-header', 'web-modal', 'mobile'].includes(source)) {
      filter.source = source;
    }
    if (search) {
      filter.query = { $regex: search, $options: 'i' };
    }

    const [logs, total, topQueries] = await Promise.all([
      SearchLog.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select('-__v')
        .populate('userId', 'name email'),

      SearchLog.countDocuments(filter),

      // Top 20 queries (most searched terms across all time, ignoring filter)
      SearchLog.aggregate([
        { $group: { _id: { $toLower: '$query' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 20 },
        { $project: { query: '$_id', count: 1, _id: 0 } },
      ]),
    ]);

    return res.json({
      logs,
      topQueries,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('getSearchLogs error:', error);
    return res.status(500).json({ message: 'Failed to fetch search logs' });
  }
};

/**
 * DELETE /api/search-logs
 * Admin only. Clear all search logs.
 */
export const clearSearchLogs = async (req, res) => {
  try {
    await SearchLog.deleteMany({});
    return res.json({ ok: true, message: 'All search logs cleared' });
  } catch (error) {
    console.error('clearSearchLogs error:', error);
    return res.status(500).json({ message: 'Failed to clear search logs' });
  }
};
