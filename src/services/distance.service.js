const https = require('https');

/**
 * Distance calculation service
 * Uses Google Distance Matrix API if key available, else Haversine fallback
 */
class DistanceService {
  async getDistance(originLat, originLng, destLat, destLng) {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
      return this.haversineResult(originLat, originLng, destLat, destLng);
    }

    try {
      const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${originLat},${originLng}&destinations=${destLat},${destLng}&key=${apiKey}&units=metric`;
      const response = await this.fetchUrl(url);
      const data = JSON.parse(response);

      if (data.status === 'OK' && data.rows[0].elements[0].status === 'OK') {
        const el = data.rows[0].elements[0];
        return {
          distance_km: parseFloat((el.distance.value / 1000).toFixed(2)),
          duration_minutes: Math.ceil(el.duration.value / 60),
          distance_text: el.distance.text,
          duration_text: el.duration.text,
          source: 'google',
        };
      }
      return this.haversineResult(originLat, originLng, destLat, destLng);
    } catch (error) {
      console.error('Google Distance API error:', error.message);
      return this.haversineResult(originLat, originLng, destLat, destLng);
    }
  }

  haversineResult(lat1, lon1, lat2, lon2) {
    const km = this.haversine(lat1, lon1, lat2, lon2);
    const mins = Math.ceil(km * 3);
    return { distance_km: parseFloat(km.toFixed(2)), duration_minutes: mins, distance_text: `${km.toFixed(1)} km`, duration_text: `${mins} mins`, source: 'haversine' };
  }

  haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)*Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

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
