const { pool } = require('../config/database');

/**
 * Seed lab reviews (dummy completed bookings with ratings)
 * Run: node src/seeders/lab-reviews.seed.js
 */
const seedLabReviews = async () => {
  try {
    console.log('🌱 Seeding lab reviews...');

    // Get first active lab
    const [labs] = await pool.query('SELECT id FROM pathology_labs WHERE is_active = 1 LIMIT 1');
    if (!labs.length) {
      console.log('❌ No active lab found. Please register a lab first.');
      process.exit(1);
    }
    const labId = labs[0].id;

    // Get first user (or create dummy user)
    let [users] = await pool.query('SELECT id FROM users LIMIT 1');
    if (!users.length) {
      console.log('❌ No user found. Please create a user first.');
      process.exit(1);
    }

    const userIds = users.map(u => u.id);

    const reviews = [
      { rating: 5.0, review: 'Excellent service! Report was delivered on time and staff was very polite.', days_ago: 2 },
      { rating: 4.5, review: 'Good lab, home collection was prompt. Slightly delayed report but overall good.', days_ago: 5 },
      { rating: 4.0, review: 'Decent experience. Clean facility and professional technicians.', days_ago: 8 },
      { rating: 5.0, review: 'Best pathology lab in the area. Very affordable prices too.', days_ago: 12 },
      { rating: 3.5, review: 'Average experience. Report was accurate but took longer than promised.', days_ago: 15 },
      { rating: 4.5, review: 'Very hygienic. The phlebotomist was skilled - didn\'t feel the needle at all!', days_ago: 20 },
      { rating: 4.0, review: 'Good pricing and accurate reports. Would recommend.', days_ago: 25 },
      { rating: 5.0, review: 'Superb! Got digital report within 4 hours. Highly professional.', days_ago: 30 },
    ];

    let inserted = 0;

    for (let i = 0; i < reviews.length; i++) {
      const r = reviews[i];
      const userId = userIds[i % userIds.length];
      const bookingId = `LAB-REV-${Date.now()}-${i}`;
      const bookingDate = new Date();
      bookingDate.setDate(bookingDate.getDate() - r.days_ago);
      const ratedAt = new Date(bookingDate);
      ratedAt.setHours(ratedAt.getHours() + 6); // rated 6 hours after booking

      await pool.query(
        `INSERT INTO bookings (booking_id, user_id, service_type, provider_id, status, booking_date, base_amount, final_amount, payment_status, payment_method, paid_at, user_rating, user_review, rated_at, confirmed_at, completed_at, created_at)
         VALUES (?, ?, 'pathology_test', ?, 'completed', ?, 500, 500, 'paid', 'online', ?, ?, ?, ?, ?, ?, ?)`,
        [
          bookingId, userId, labId,
          bookingDate.toISOString().split('T')[0],
          bookingDate, r.rating, r.review, ratedAt,
          bookingDate, ratedAt, bookingDate
        ]
      );
      inserted++;
    }

    // Update lab average rating
    const [avgResult] = await pool.query(
      `SELECT AVG(user_rating) as avg_rating FROM bookings WHERE service_type = 'pathology_test' AND provider_id = ? AND user_rating IS NOT NULL`,
      [labId]
    );
    const avgRating = avgResult[0].avg_rating ? parseFloat(avgResult[0].avg_rating).toFixed(2) : 0;
    await pool.query('UPDATE pathology_labs SET average_rating = ? WHERE id = ?', [avgRating, labId]);

    console.log(`✅ ${inserted} reviews inserted for lab ID: ${labId}`);
    console.log(`⭐ Average rating updated to: ${avgRating}`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error.message);
    process.exit(1);
  }
};

seedLabReviews();
