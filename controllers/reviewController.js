import Product from '../models/Product.js';
import { validateReviewData } from '../utils/validation.js';

// Get all reviews (admin)
export const getAllReviews = async (req, res) => {
  try {
    const products = await Product.find()
      .populate({
        path: 'reviews.user',
        select: 'name email image'
      })
      .select('name images reviews');

    const reviews = products.reduce((allReviews, product) => {
      const productReviews = product.reviews.map(review => ({
        ...review.toObject(),
        product: {
          _id: product._id,
          name: product.name,
          images: product.images
        }
      }));
      return [...allReviews, ...productReviews];
    }, []);

    res.json(reviews);
  } catch (error) {
    console.error('Error fetching reviews:', error);
    res.status(500).json({ message: 'Failed to fetch reviews' });
  }
};

// Add review
export const addReview = async (req, res) => {
  try {
    const { rating, comment, photos = [], fit, quality } = req.body;
    const product = await Product.findById(req.params.id);
    
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Validate review data
    const { isValid, errors } = validateReviewData({ rating, comment, photos });
    if (!isValid) {
      return res.status(400).json({ message: 'Invalid review data', errors });
    }

    // Check if user has already reviewed this product
    const existingReview = product.reviews.find(
      review => review.user.toString() === req.user._id.toString()
    );

    if (existingReview) {
      return res.status(400).json({ message: 'You have already reviewed this product' });
    }

    const review = {
      user: req.user._id,
      rating,
      comment,
      photos,
      ...(typeof fit === 'number' ? { fit } : {}),
      ...(typeof quality === 'number' ? { quality } : {}),
      verified: await hasUserPurchasedProduct(req.user._id, product._id),
      createdAt: new Date()
    };

    product.reviews.push(review);

    // Update average rating
    const totalRating = product.reviews.reduce((sum, review) => sum + review.rating, 0);
    product.rating = totalRating / product.reviews.length;

    await product.save();
    
    // Populate user info before sending response
    const populatedProduct = await Product.findById(product._id)
      .populate({
        path: 'reviews.user',
        select: 'name email image'
      });

    const addedReview = populatedProduct.reviews[populatedProduct.reviews.length - 1];
    
    res.status(201).json(addedReview);
  } catch (error) {
    console.error('Error adding review:', error);
    res.status(400).json({ message: error.message });
  }
};

// Mark review as helpful
export const markReviewHelpful = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const review = product.reviews.id(req.params.reviewId);
    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    // Check if user has already marked this review as helpful
    if (review.helpfulBy?.includes(req.user._id)) {
      return res.status(400).json({ message: 'You have already marked this review as helpful' });
    }

    // Add user to helpfulBy array and increment helpful count
    review.helpfulBy = review.helpfulBy || [];
    review.helpfulBy.push(req.user._id);
    review.helpful = (review.helpful || 0) + 1;

    await product.save();
    
    res.json(review);
  } catch (error) {
    console.error('Error marking review as helpful:', error);
    res.status(400).json({ message: error.message });
  }
};

// Report review
export const reportReview = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const review = product.reviews.id(req.params.reviewId);
    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    // Check if user has already reported this review
    if (review.reportedBy?.includes(req.user._id)) {
      return res.status(400).json({ message: 'You have already reported this review' });
    }

    // Add user to reportedBy array and mark as reported
    review.reportedBy = review.reportedBy || [];
    review.reportedBy.push(req.user._id);
    review.reported = true;
    review.reportReason = req.body.reason;

    await product.save();
    
    res.json({ message: 'Review reported successfully' });
  } catch (error) {
    console.error('Error reporting review:', error);
    res.status(400).json({ message: error.message });
  }
};

// Verify review (admin)
export const verifyReview = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const review = product.reviews.id(req.params.reviewId);
    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    review.verified = true;
    review.verifiedAt = new Date();
    review.verifiedBy = req.user._id;

    await product.save();
    
    res.json(review);
  } catch (error) {
    console.error('Error verifying review:', error);
    res.status(400).json({ message: error.message });
  }
};

// Update review
export const updateReview = async (req, res) => {
  try {
    const { rating, comment, existingPhotos = [], fit, quality } = req.body;
    const product = await Product.findById(req.params.id);
    
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const review = product.reviews.id(req.params.reviewId);
    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    // Check if user is the review owner
    if (review.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to update this review' });
    }

    // Validate review data
    const { isValid, errors } = validateReviewData({ rating, comment, photos: [] });
    if (!isValid) {
      return res.status(400).json({ message: 'Invalid review data', errors });
    }

    // Update review fields
    review.rating = rating;
    review.comment = comment;
    review.updatedAt = new Date();
    if (typeof fit === 'number') review.fit = fit;
    if (typeof quality === 'number') review.quality = quality;
    
    // Handle photos
    let photos = [];
    
    // Keep existing photos that are still selected
    if (typeof existingPhotos === 'string') {
      try {
        const parsedPhotos = JSON.parse(existingPhotos);
        photos = Array.isArray(parsedPhotos) ? parsedPhotos : [];
      } catch (error) {
        photos = [];
      }
    } else if (Array.isArray(existingPhotos)) {
      photos = existingPhotos;
    }
    
    review.photos = photos.slice(0, 5); // Limit to 5 photos

    // Recalculate average rating
    const totalRating = product.reviews.reduce((sum, r) => sum + r.rating, 0);
    product.rating = totalRating / product.reviews.length;

    await product.save();
    
    await product.populate({
      path: 'reviews.user',
      select: 'name email image'
    });

    const updatedReview = product.reviews.id(req.params.reviewId);
    
    res.json({
      message: 'Review updated successfully',
      review: updatedReview
    });
  } catch (error) {
    console.error('Error updating review:', error);
    res.status(400).json({ message: error.message });
  }
};

// Delete review (admin or review owner)
export const deleteReview = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const review = product.reviews.id(req.params.reviewId);
    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    // Check if user is admin or review owner
    if (req.user.role !== 'admin' && review.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to delete this review' });
    }

    // Remove review
    product.reviews = product.reviews.filter(
      r => r._id.toString() !== req.params.reviewId
    );
    
    // Update average rating
    if (product.reviews.length > 0) {
      const totalRating = product.reviews.reduce((sum, r) => sum + r.rating, 0);
      product.rating = totalRating / product.reviews.length;
    } else {
      product.rating = 0;
    }

    await product.save();
    
    res.json({ message: 'Review deleted successfully' });
  } catch (error) {
    console.error('Error deleting review:', error);
    res.status(400).json({ message: error.message });
  }
};

// Check eligibility to write a review for a specific product (used by mobile app)
// Returns: { purchased: boolean, alreadyReviewed: boolean, canReview: boolean }
export const getReviewEligibility = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).select('_id reviews');
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const userId = req.user?._id;
    if (!userId) {
      // Should not happen when protected by auth, but keep safe fallback
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const alreadyReviewed = Array.isArray(product.reviews)
      ? product.reviews.some(r => String(r.user) === String(userId))
      : false;

    const purchased = await hasUserPurchasedProduct(userId, product._id);

    // Current business rule: allow any logged-in user to review once; mark as verified if purchased
    const canReview = !alreadyReviewed;

    return res.json({ purchased, alreadyReviewed, canReview });
  } catch (error) {
    console.error('Error checking review eligibility:', error);
    return res.status(500).json({ message: 'Failed to check eligibility' });
  }
};

// Helper function to check if user has purchased product
async function hasUserPurchasedProduct(userId, productId) {
  try {
    const Order = (await import('../models/Order.js')).default;
    const order = await Order.findOne({
      user: userId,
      'items.product': productId,
      status: 'delivered'
    });
    return !!order;
  } catch (error) {
    console.error('Error checking purchase history:', error);
    return false;
  }
}