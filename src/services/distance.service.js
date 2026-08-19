const https = require('https');

/**
 * Google Distance Matrix API Service
 * Calculates distance & time between two points
 */
class DistanceService {
  /**
   * Get distance and duration between two points
   * @param {number} originLat
   * @param {number} originLng
   * @param {number} destLat
   * @param {number} destLng
   * @returns {{ distance_km, duration_minutes, distance_text, duration_text }}
   */
  async getDistance(originLat, originLng, destLat, destLng) {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
      // Fallback: Haversine formula (straight line distance)
      const km = this.haversine(originLat, originLng, destLat, destLng);
      const estimatedMinutes = Math.ceil(km * 3); // ~20 km/h avg in city
      return {
        distance_km: parseFloat(km.toFixed(2)),
        duration_minutes: estimatedMinutes,
        distance_text: `${km.toFixed(1)} km`,
        duration_text: `${estimatedMinutes} mins`,
        source: 'haversine',
      };
    }

    try {
      const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${originLat},${originLng}&destinations=${destLat},${destLng}&key=${apiKey}&units=metric`;

      const response = await this.fetchUrl(url);
      const data = JSON.parse(response);

      if (data.status === 'OK' && data.rows[0].elements[0].status === 'OK') {
        const element = data.rows[0].elements[0];
        return {
          distance_km: parseFloat((element.distance.value / 1000).toFixed(2)),
          duration_minutes: Math.ceil(element.duration.value / 60),
          distance_text: element.distance.text,
          duration_text: element.duration.text,
          source: 'google',
        };
      }

      // Fallback if Google returns error
      const km = this.haversine(originLat, originLng, destLat, destLng);
      return { distance_km: parseFloat(km.toFixed(2)), duration_minutes: Math.ceil(km * 3), distance_text: `${km.toFixed(1)} km`, duration_text: `${Math.ceil(km * 3)} mins`, source: 'haversine_fallback' };
    } catch (error) {
      console.error('Google Distance API error:', error.message);
      const km = this.haversine(originLat, originLng, destLat, destLng);
      return { distance_km: parseFloat(km.toFixed(2)), duration_minutes: Math.ceil(km * 3), distance_text: `${km.toFixed(1)} km`, duration_text: `${Math.ceil(km * 3)} mins`, source: 'haversine_fallback' };
    }
  }

  /**
   * Haversine formula - straight line distance in km
   */
  haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  toRad(deg) { return deg * (Math.PI / 180); }

  fetchUrl(url) {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });
  }
}

module.exports = new DistanceService();
