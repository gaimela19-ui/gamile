import mongoose from 'mongoose';

const SEARCH_LOG_RETENTION_DAYS = Number(process.env.SEARCH_LOG_RETENTION_DAYS || '365');
const SEARCH_LOG_RETENTION_SECONDS = Number.isFinite(SEARCH_LOG_RETENTION_DAYS) && SEARCH_LOG_RETENTION_DAYS > 0
  ? SEARCH_LOG_RETENTION_DAYS * 24 * 60 * 60
  : 365 * 24 * 60 * 60;

const searchLogSchema = new mongoose.Schema(
  {
    query: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      index: true,
    },
    source: {
      type: String,
      enum: ['web', 'web-header', 'web-modal', 'mobile'],
      default: 'web',
      index: true,
    },
    resultsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

// TTL: auto-delete logs older than the configured retention window
searchLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: SEARCH_LOG_RETENTION_SECONDS });

const SearchLog = mongoose.model('SearchLog', searchLogSchema);
export default SearchLog;
