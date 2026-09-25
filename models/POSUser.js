import mongoose from 'mongoose';

const posUserSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // POS-specific permissions and settings
  permissions: {
    canOpenRegister: { type: Boolean, default: false },
    canCloseRegister: { type: Boolean, default: false },
    canProcessSales: { type: Boolean, default: true },
    canProcessRefunds: { type: Boolean, default: false },
    canVoidTransactions: { type: Boolean, default: false },
    canApplyDiscounts: { type: Boolean, default: false },
    maxDiscountPercent: { type: Number, default: 0 },
    canViewReports: { type: Boolean, default: false },
    canManageInventory: { type: Boolean, default: false },
    canAccessAllRegisters: { type: Boolean, default: false }
  },
  // Assigned registers (if not allowed to access all)
  assignedRegisters: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'POSRegister'
  }],
  // Employee information
  employeeId: String,
  pin: {
    type: String,
    select: false // Don't include in regular queries
  },
  // Performance tracking
  totalSales: { type: Number, default: 0 },
  totalTransactions: { type: Number, default: 0 },
  averageTransactionValue: { type: Number, default: 0 },
  // Status and activity
  isActive: { type: Boolean, default: true },
  lastLoginAt: Date,
  currentSession: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'POSSession'
  },
  // Settings and preferences
  preferences: {
    defaultRegister: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'POSRegister'
    },
    receiptSettings: {
      autoPrint: { type: Boolean, default: true },
      emailReceipts: { type: Boolean, default: false }
    },
    displaySettings: {
      theme: { type: String, default: 'light' },
      fontSize: { type: String, default: 'medium' }
    }
  }
}, {
  timestamps: true
});

// Indexes for better performance
posUserSchema.index({ user: 1 }, { unique: true });
posUserSchema.index({ employeeId: 1 });
posUserSchema.index({ isActive: 1 });
posUserSchema.index({ assignedRegisters: 1 });

// Virtual for full permissions (combining user role and POS permissions)
posUserSchema.virtual('effectivePermissions').get(function() {
  // This would need to be populated with the actual user data
  return this.permissions;
});

// Method to check if user can access a specific register
posUserSchema.methods.canAccessRegister = function(registerId) {
  if (this.permissions.canAccessAllRegisters) {
    return true;
  }
  return this.assignedRegisters.some(reg => reg.toString() === registerId.toString());
};

// Method to update performance metrics
posUserSchema.methods.updatePerformanceMetrics = async function(transactionAmount) {
  this.totalTransactions += 1;
  this.totalSales += transactionAmount;
  this.averageTransactionValue = this.totalSales / this.totalTransactions;
  await this.save();
};

export default mongoose.model('POSUser', posUserSchema);