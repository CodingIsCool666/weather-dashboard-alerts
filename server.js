const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all routes. This allows the frontend to make AJAX
// requests against the API even when served from a different domain.
app.use(cors());

// Serve static files from the "public" folder. This allows the frontend
// HTML, CSS and JavaScript files to be delivered by the same Express
// server that hosts the API.
app.use(express.static(path.join(__dirname, 'public')));

const API_KEY = process.env.OPENWEATHER_API_KEY;
if (!API_KEY) {
  console.warn(
    'Warning: No OpenWeather API key provided. Create a .env file based on .env.sample and set OPENWEATHER_API_KEY.'
  );
}

/**
 * Utility: Build the OpenWeather URL for current conditions. Accepts either a city
 * name or latitude/longitude coordinates. Always requests metric units to
 * simplify server‑side calculations. The units can be converted on the client.
 *
 * @param {Object} params
 * @returns {string}
 */
function buildCurrentUrl(params) {
  const base = 'https://api.openweathermap.org/data/2.5/weather';
  const query = new URLSearchParams({ appid: API_KEY, units: 'metric' });
  if (params.city) query.append('q', params.city);
  if (params.lat && params.lon) {
    query.append('lat', params.lat);
    query.append('lon', params.lon);
  }
  return `${base}?${query.toString()}`;
}

/**
 * Utility: Build the OpenWeather URL for forecast. Accepts either a city
 * name or latitude/longitude coordinates. Always requests metric units.
 *
 * @param {Object} params
 * @returns {string}
 */
function buildForecastUrl(params) {
  const base = 'https://api.openweathermap.org/data/2.5/forecast';
  const query = new URLSearchParams({ appid: API_KEY, units: 'metric' });
  if (params.city) query.append('q', params.city);
  if (params.lat && params.lon) {
    query.append('lat', params.lat);
    query.append('lon', params.lon);
  }
  return `${base}?${query.toString()}`;
}

/**
 * Determine human‑friendly alerts based on current weather conditions.
 * This function is intentionally simple; you can expand it as needed.
 *
 * @param {number} tempC Temperature in Celsius
 * @param {number} windSpeed Wind speed in m/s
 * @param {string} description Main weather description
 * @returns {string[]} List of alert messages
 */
function determineAlerts(tempC, windSpeed, description) {
  const alerts = [];
  if (tempC >= 35) {
    alerts.push('Heatwave: Stay hydrated and avoid direct sunlight.');
  }
  if (tempC <= -5) {
    alerts.push('Extreme cold: Dress warmly and limit time outdoors.');
  }
  if (windSpeed >= 10) {
    alerts.push('Strong winds: Secure outdoor items and exercise caution.');
  }
  const desc = description.toLowerCase();
  if (desc.includes('thunderstorm') || desc.includes('storm')) {
    alerts.push('Thunderstorm: Seek shelter and stay away from windows.');
  }
  if (desc.includes('snow')) {
    alerts.push('Snow: Roads may be slippery; drive carefully.');
  }
  return alerts;
}

/**
 * GET /api/weather
 * Returns current weather data for a given city or coordinates.
 * Query parameters:
 *   - city: Name of the city (optional if lat/lon provided)
 *   - lat, lon: Latitude and longitude coordinates (optional if city provided)
 */
// ==== CURRENT WEATHER + ADVISORIES ====
// ==== CURRENT WEATHER + ADVISORIES (clean numbers) ====
app.get('/api/weather', async (req, res) => {
  try {
    const { city, lat, lon } = req.query;
    const API = process.env.OPENWEATHER_API_KEY;

    let url;
    if (city) {
      url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${API}&units=metric`;
    } else if (lat && lon) {
      url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API}&units=metric`;
    } else {
      return res.status(400).json({ error: 'Provide ?city= or ?lat=&lon=' });
    }

    const { data } = await axios.get(url);

    // helpers to sanitize numbers
    const num = (n) => (Number.isFinite(+n) ? +n : null);
    const int = (n) => (Number.isFinite(+n) ? Math.round(+n) : null);

    const t        = num(data?.main?.temp);
    const feels    = num(data?.main?.feels_like);
    const humidity = int(data?.main?.humidity);     // % as integer from API (0–100)
    const windMS   = num(data?.wind?.speed);        // m/s (because units=metric)

    const wid  = data?.weather?.[0]?.id ?? 0;
    const desc = data?.weather?.[0]?.description || '';

    // simple computed advisories (optional)
    const alerts = [];
    if (t != null && (t >= 35 || (feels != null && feels >= 35))) alerts.push('Heat advisory (≥ 35°C)');
    if (t != null && t <= 0) alerts.push('Freeze risk (≤ 0°C)');
    if (windMS != null && windMS >= 15) alerts.push('High wind (≥ 15 m/s)');
    if (wid >= 200 && wid < 300) alerts.push('Thunderstorm');

    res.json({
      location: data.name || '',
      country: data.sys?.country || '',
      coord: { lat: data.coord?.lat, lon: data.coord?.lon },
      timezone: data.timezone ?? 0,       // seconds offset from UTC
      dt: data.dt ?? null,                 // timestamp of this observation
      temp: t,                             // °C
      feels_like: feels,                   // °C (from API)
      humidity,                            // % 0–100
      wind_speed: windMS,                  // m/s
      sunrise: data.sys?.sunrise ?? null,  // unix
      sunset: data.sys?.sunset ?? null,    // unix
      description: desc,
      alerts
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch weather' });
  }
});



/**
 * GET /api/forecast
 * Returns a simplified 5‑day forecast for a given city or coordinates.
 * Query parameters:
 *   - city: Name of the city (optional if lat/lon provided)
 *   - lat, lon: Latitude and longitude coordinates (optional if city provided)
 */
// ==== DAILY FORECAST (5 days, local-time aware, proper hi/lo) ====
app.get('/api/forecast', async (req, res) => {
  try {
    const { city, lat, lon } = req.query;
    const API = process.env.OPENWEATHER_API_KEY;

    let fUrl, cUrl;
    if (city) {
      const q = encodeURIComponent(city);
      fUrl = `https://api.openweathermap.org/data/2.5/forecast?q=${q}&appid=${API}&units=metric`;
      cUrl = `https://api.openweathermap.org/data/2.5/weather?q=${q}&appid=${API}&units=metric`;
    } else if (lat && lon) {
      fUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${API}&units=metric`;
      cUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API}&units=metric`;
    } else {
      return res.status(400).json({ error: 'Provide ?city= or ?lat=&lon=' });
    }

    const [fResp, cResp] = await Promise.all([axios.get(fUrl), axios.get(cUrl)]);
    const fData = fResp.data;
    const cData = cResp.data;
    const tz = fData?.city?.timezone ?? cData?.timezone ?? 0; // seconds offset from UTC

    // Group forecast slices by LOCAL calendar day using city timezone
    const buckets = new Map(); // key YYYY-MM-DD, value { maxes:[], mins:[], descs:[], epochDay }
    for (const item of fData.list) {
      const localSec = item.dt + tz;
      const local = new Date(localSec * 1000);
      const y = local.getUTCFullYear();
      const m = local.getUTCMonth();
      const d = local.getUTCDate();
      const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const epochDay = Date.UTC(y, m, d);

      if (!buckets.has(key)) buckets.set(key, { maxes: [], mins: [], descs: [], epochDay });
      const b = buckets.get(key);

      const tmax = typeof item.main?.temp_max === 'number' ? item.main.temp_max : item.main?.temp;
      const tmin = typeof item.main?.temp_min === 'number' ? item.main.temp_min : item.main?.temp;
      if (typeof tmax === 'number') b.maxes.push(tmax);
      if (typeof tmin === 'number') b.mins.push(tmin);

      const desc = item.weather?.[0]?.description;
      if (desc) b.descs.push(desc);
    }

    // Also fold in "current weather" into TODAY's bucket to avoid single-point days
    {
      const localNow = new Date(Date.now() + tz * 1000);
      const y = localNow.getUTCFullYear();
      const m = localNow.getUTCMonth();
      const d = localNow.getUTCDate();
      const todayKey = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (!buckets.has(todayKey)) buckets.set(todayKey, { maxes: [], mins: [], descs: [], epochDay: Date.UTC(y, m, d) });

      const b = buckets.get(todayKey);
      const cmax = typeof cData.main?.temp_max === 'number' ? cData.main.temp_max : cData.main?.temp;
      const cmin = typeof cData.main?.temp_min === 'number' ? cData.main.temp_min : cData.main?.temp;
      if (typeof cmax === 'number') b.maxes.push(cmax);
      if (typeof cmin === 'number') b.mins.push(cmin);
      const cdesc = cData.weather?.[0]?.description;
      if (cdesc) b.descs.push(cdesc);
    }

    // Summarize each day
    let days = Array.from(buckets.values())
      .sort((a, b) => a.epochDay - b.epochDay)
      .map(b => {
        const temp_max = b.maxes.length ? Math.max(...b.maxes) : null;
        const temp_min = b.mins.length ? Math.min(...b.mins) : null;

        // representative description (mode)
        const counts = {};
        let best = '', bestCount = 0;
        for (const d of b.descs) { counts[d] = (counts[d] || 0) + 1; if (counts[d] > bestCount) { bestCount = counts[d]; best = d; } }

        return { date: new Date(b.epochDay).toISOString(), temp_max, temp_min, description: best };
      });

    // Start at "today" (city local) → next 5 days
    {
      const localNow = new Date(Date.now() + tz * 1000);
      const todayEpoch = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate());
      days = days.filter(d => new Date(d.date).getTime() >= todayEpoch).slice(0, 5);
    }

    res.json({ forecast: days });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch forecast' });
  }
});


// Geocoding: text -> places (limit 5)
app.get('/api/geocode', async (req, res) => {
  try {
    const q = req.query.q || req.query.query;
    const limit = Math.min(parseInt(req.query.limit || '5', 10), 10);
    if (!q) return res.status(400).json({ error: 'Provide ?q=' });

    const API = process.env.OPENWEATHER_API_KEY;
    const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(q)}&limit=${limit}&appid=${API}`;

    const { data } = await axios.get(url);
    const results = (data || []).map(p => ({
      name: p.name,
      state: p.state || '',
      country: p.country || '',
      lat: p.lat,
      lon: p.lon,
    }));
    res.json({ results });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Geocode failed' });
  }
});

// Reverse geocoding: lat/lon -> nice label (optional, for geolocation)
app.get('/api/revgeo', async (req, res) => {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'Provide lat & lon' });
    const API = process.env.OPENWEATHER_API_KEY;
    const url = `https://api.openweathermap.org/geo/1.0/reverse?lat=${lat}&lon=${lon}&limit=1&appid=${API}`;
    const { data } = await axios.get(url);
    const p = (data && data[0]) || {};
    res.json({
      name: p.name || '',
      state: p.state || '',
      country: p.country || '',
      lat: Number(lat),
      lon: Number(lon),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Reverse geocode failed' });
  }
});


// Fallback route: send index.html for all unknown routes to support
// client‑side routing (useful if you later add a SPA). Place this last.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Weather dashboard server listening on port ${PORT}`);
});