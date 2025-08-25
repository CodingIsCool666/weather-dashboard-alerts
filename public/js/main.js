(() => {
  const $ = (id) => document.getElementById(id);

  // --- Controls / Elements ---
  const cityInput = $('cityInput');
  const unitSelect = $('unitSelect');
  const searchBtn = $('searchBtn');
  const geoBtn = $('geoBtn');
  const themeToggle = $('themeToggle');
  const saveCurrentBtn = $('saveCurrentBtn');

  const alertContainer = $('alertContainer');

  // Current weather fields
  const cwCity = $('cw-city');
  const cwTZ = $('cw-timezone');
  const cwTemp = $('cw-temp');
  const cwDesc = $('cw-desc');
  const cwFeels = $('cw-feels');
  const cwHumidity = $('cw-humidity');
  const cwWind = $('cw-wind');
  const cwSun = $('cw-sun');

  // Forecast & chart
  const forecastCards = $('forecastCards');
  const tempChartCanvas = $('tempChart');
  let chart = null;

  // Favorites
  const favoritesList = $('favoritesList');

  // Suggestions (optional)
  const suggestBox = $('citySuggest');

  // --- State ---
  let currentCityLabel = null;   // "Paris, Île-de-France, FR"
  let currentCoords = null;      // { lat, lon }

  // ===================== THEME =====================
  initTheme();
  function initTheme() {
    const saved = localStorage.getItem('theme') || 'dark';
    setTheme(saved);
    if (themeToggle) {
      themeToggle.checked = saved === 'dark';
      themeToggle.addEventListener('change', () =>
        setTheme(themeToggle.checked ? 'dark' : 'light')
      );
    }
  }
  function setTheme(mode) {
    const body = document.body;
    body.dataset.bsTheme = mode; // Bootstrap 5.3 color-mode
    body.classList.toggle('theme-dark', mode === 'dark');
    body.classList.toggle('theme-light', mode === 'light');
    localStorage.setItem('theme', mode);
    applyChartTheme(mode);
  }
  function applyChartTheme(mode) {
    if (!window.Chart) return;
    const fg = mode === 'dark' ? '#e5e7eb' : '#111827';
    const grid = mode === 'dark' ? 'rgba(229,231,235,0.18)' : 'rgba(17,24,39,0.12)';
    Chart.defaults.color = fg;
    Chart.defaults.borderColor = grid;
    if (chart) {
      const s = chart.options.scales || {};
      if (s.x) {
        s.x.ticks = { ...(s.x.ticks || {}), color: fg };
        s.x.grid  = { ...(s.x.grid  || {}), color: grid };
      }
      if (s.y) {
        s.y.ticks = { ...(s.y.ticks || {}), color: fg };
        s.y.grid  = { ...(s.y.grid  || {}), color: grid };
      }
      chart.update();
    }
  }

  // ===================== UTILS =====================
  const debounce = (fn, ms = 250) => { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; };
  function convertTemp(c, unit) { return unit === 'imperial' ? (c * 9) / 5 + 32 : c; }
  function convertWind(ms, unit) { return unit === 'imperial' ? ms * 2.23694 : ms; }
  function fmtTemp(c, unit) { const v = convertTemp(c, unit); return `${v.toFixed(1)}°${unit === 'imperial' ? 'F' : 'C'}`; }
  function fmtWind(ms, unit) { const v = convertWind(ms, unit); return `${v.toFixed(1)} ${unit === 'imperial' ? 'mph' : 'm/s'}`; }

  // ---- Time helpers (CITY-time aware) ----
  function fmtGmtOffset(seconds) {
    if (seconds == null || isNaN(seconds)) return 'UTC±00:00';
    const sign = seconds >= 0 ? '+' : '-';
    const abs = Math.abs(seconds);
    const h = Math.floor(abs / 3600);
    const m = Math.floor((abs % 3600) / 60);
    return `UTC${sign}${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  }
  // Current clock in the CITY: shift now by offset, then format as UTC
  function fmtLocalClock(offsetSeconds) {
    const d = new Date(Date.now() + (offsetSeconds || 0) * 1000);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  }
  // Convert a UNIX (UTC) timestamp to CITY local time using offset
  function fmtTimeWithOffset(unixSeconds, offsetSeconds) {
    if (!unixSeconds && unixSeconds !== 0) return '—';
    const d = new Date((unixSeconds + (offsetSeconds || 0)) * 1000);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  }

  function showAlert(html, type = 'warning') {
    if (!alertContainer) return;
    alertContainer.innerHTML =
      `<div class="alert alert-${type} alert-dismissible fade show" role="alert">
        ${html}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
      </div>`;
  }
  function clearAlert() { if (alertContainer) alertContainer.innerHTML = ''; }

  // ===================== FAVORITES =====================
  function loadFavorites() {
    try { const f = JSON.parse(localStorage.getItem('favorites')); return Array.isArray(f) ? f : []; }
    catch { return []; }
  }
  function saveFavorites(list) { localStorage.setItem('favorites', JSON.stringify(list)); }
  function renderFavorites() {
    if (!favoritesList) return;
    const favs = loadFavorites();
    favoritesList.innerHTML = '';

    if (favs.length === 0) {
      favoritesList.innerHTML = `<div class="text-muted text-center py-3 small">No saved locations.</div>`;
      return;
    }

    favs.forEach((item, idx) => {
      const isString = typeof item === 'string';
      const label = isString ? item : [item.name, item.state, item.country].filter(Boolean).join(', ');

      const row = document.createElement('div');
      row.className = 'd-flex justify-content-between align-items-center border rounded-3 p-2';
      row.innerHTML = `<span class="fw-semibold">${label}</span>`;

      const grp = document.createElement('div');
      grp.className = 'btn-group btn-group-sm';

      const loadBtn = document.createElement('button');
      loadBtn.className = 'btn btn-outline-primary';
      loadBtn.textContent = 'Load';
      loadBtn.onclick = () => {
        if (isString) {
          cityInput && (cityInput.value = item);
          fetchWeather({ city: item });
        } else {
          cityInput && (cityInput.value = label);
          fetchWeather({ lat: item.lat, lon: item.lon, label });
        }
      };

      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-outline-danger';
      delBtn.textContent = 'Remove';
      delBtn.onclick = () => {
        const list = loadFavorites();
        list.splice(idx, 1);          // remove by index (works for strings/objects)
        saveFavorites(list);
        renderFavorites();
      };

      grp.append(loadBtn, delBtn);
      row.append(grp);
      favoritesList.append(row);
    });
  }
  function addCurrentToFavorites() {
    if (!currentCoords) return;
    const favs = loadFavorites();
    const entry = { name: currentCityLabel || 'Saved Location', lat: currentCoords.lat, lon: currentCoords.lon };
    if (!favs.some(f => typeof f !== 'string' && f.lat === entry.lat && f.lon === entry.lon)) {
      favs.push(entry); saveFavorites(favs); renderFavorites();
    }
  }

  // ===================== RENDERERS =====================
  function renderWeather(data, unit) {
    const label = [data.location, data.country].filter(Boolean).join(', ');
    if (cwCity) cwCity.textContent = label || '—';

    // City-local clock
    const off = Number(data.timezone || 0);
    if (cwTZ) cwTZ.textContent = `Local time: ${fmtLocalClock(off)} (${fmtGmtOffset(off)})`;

    // Description
    if (cwDesc) cwDesc.textContent = data.description || '—';

    // Temperatures (from API, °C -> convert for display)
    if (cwTemp && Number.isFinite(data.temp)) {
      cwTemp.textContent = fmtTemp(data.temp, unit);
    } else if (cwTemp) cwTemp.textContent = '—';

    if (cwFeels && Number.isFinite(data.feels_like)) {
      cwFeels.textContent = fmtTemp(data.feels_like, unit);
    } else if (cwFeels) cwFeels.textContent = '—';

    // Humidity (API already gives percent 0–100)
    if (cwHumidity && Number.isFinite(data.humidity)) {
      cwHumidity.textContent = `${Math.round(data.humidity)}%`;
    } else if (cwHumidity) cwHumidity.textContent = '—';

    // Wind (server gives m/s; convert only for imperial)
    if (cwWind && Number.isFinite(data.wind_speed)) {
      cwWind.textContent = fmtWind(data.wind_speed, unit); // shows m/s or mph accordingly
    } else if (cwWind) cwWind.textContent = '—';

    // Sunrise/Sunset in city local time
    if (cwSun) {
      const rise = fmtTimeWithOffset(data.sunrise, off);
      const set  = fmtTimeWithOffset(data.sunset, off);
      cwSun.textContent = `${rise} / ${set}`;
    }

    // Alerts
    if (Array.isArray(data.alerts)) {
      if (data.alerts.length) {
        showAlert(`<strong>Advisories:</strong> ${data.alerts.join(' • ')}`, 'warning');
      } else {
        showAlert('No current advisories for this location.', 'info');
      }
    } else {
      clearAlert();
    }
  }

  // Render forecast (supports {temp_max,temp_min} or single {temp})
  function renderForecast(items, unit) {
    if (!Array.isArray(items)) return;

    // Cards
    if (forecastCards) {
      forecastCards.innerHTML = '';
      items.slice(0, 5).forEach(it => {
        const d = new Date(it.date);
        const label = d.toLocaleDateString(undefined, {
          weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' // date already shifted server-side
        });
        const hi = typeof it.temp_max === 'number' ? convertTemp(it.temp_max, unit) : NaN;
        const lo = typeof it.temp_min === 'number' ? convertTemp(it.temp_min, unit) : NaN;

        forecastCards.insertAdjacentHTML('beforeend',
          `<div class="p-3 border rounded-3 text-center small" style="min-width: 140px">
             <div class="fw-semibold mb-1">${label}</div>
             <div class="fs-6">${isNaN(hi) ? '—' : hi.toFixed(1)}° / ${isNaN(lo) ? '—' : lo.toFixed(1)}°</div>
             <div class="text-muted">${it.description || ''}</div>
           </div>`);
      });
    }

    // Chart: highs only; labels include date
    if (tempChartCanvas) {
      if (chart) chart.destroy();
      const labels = items.map(it => {
        const d = new Date(it.date);
        return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
      });
      const highs = items.map(it => convertTemp(
        typeof it.temp_max === 'number' ? it.temp_max : (it.temp ?? NaN),
        unit
      ));

      chart = new Chart(tempChartCanvas.getContext('2d'), {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: `Daily High (${unit === 'imperial' ? '°F' : '°C'})`,
            data: highs,
            tension: 0.3,
            borderWidth: 2,
            fill: false
          }]
        },
        options: {
          responsive: true,
          plugins: { legend: { display: true } },
          scales: {
            y: { title: { display: true, text: unit === 'imperial' ? '°F' : '°C' } },
            x: { title: { display: true, text: 'Today → +4 days' } }
          }
        }
      });

      applyChartTheme(document.body.dataset.bsTheme || 'dark');
    }
  }

  // ===================== DATA =====================
  async function fetchWeather({ city, lat, lon, label }) {
    const origBtnHTML = searchBtn?.innerHTML;
    try {
      if (searchBtn) { searchBtn.disabled = true; searchBtn.innerHTML = 'Searching…'; }

      const unit = unitSelect?.value || 'metric';
      const q = city ? `city=${encodeURIComponent(city)}` : `lat=${lat}&lon=${lon}`;

      const wRes = await fetch(`/api/weather?${q}`);
      const wJson = await wRes.json();
      if (!wRes.ok) throw new Error(wJson.error || 'Failed to fetch weather');

      const fRes = await fetch(`/api/forecast?${q}`);
      const fJson = await fRes.json();
      if (!fRes.ok) throw new Error(fJson.error || 'Failed to fetch forecast');

      currentCoords = wJson.coord;
      currentCityLabel = label || [wJson.location, wJson.country].filter(Boolean).join(', ');

      renderWeather(wJson, unit);
      renderForecast(fJson.forecast, unit);
    } catch (err) {
      console.error(err);
      showAlert(err.message || 'Something went wrong.', 'danger');
    } finally {
      if (searchBtn) { searchBtn.disabled = false; searchBtn.innerHTML = origBtnHTML || 'Search'; }
    }
  }

  // ===================== SUGGESTIONS (Geocoding) =====================
  let suggestItems = [];
  let suggestIndex = -1;

  function formatPlace(p) {
    return [p.name, p.state, p.country].filter(Boolean).join(', ');
  }
  function showSuggestions(list) {
    if (!suggestBox) return;
    suggestItems = list; suggestIndex = -1;
    if (!list.length) return hideSuggestions();

    suggestBox.innerHTML = list.map((p, i) => `
      <button type="button"
        class="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
        data-index="${i}">
        <span>${formatPlace(p)}</span>
        <small class="text-muted">${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}</small>
      </button>
    `).join('');
    suggestBox.classList.remove('d-none');
  }
  function hideSuggestions() {
    if (!suggestBox) return;
    suggestBox.classList.add('d-none');
    suggestBox.innerHTML = '';
    suggestItems = [];
    suggestIndex = -1;
  }
  const requestSuggestions = debounce(async (q) => {
    if (!suggestBox) return;
    if (!q || q.length < 2) return hideSuggestions();
    try {
      const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}&limit=5`);
      const j = await r.json();
      showSuggestions(j.results || []);
    } catch { hideSuggestions(); }
  }, 250);

  // Input bindings
  cityInput?.addEventListener('input', (e) => {
    requestSuggestions(e.target.value.trim());
  });
  cityInput?.addEventListener('keydown', (e) => {
    if (!suggestBox || suggestBox.classList.contains('d-none') || suggestItems.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); suggestIndex = (suggestIndex + 1) % suggestItems.length; highlightSuggest(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); suggestIndex = (suggestIndex - 1 + suggestItems.length) % suggestItems.length; highlightSuggest(); }
    else if (e.key === 'Enter') { e.preventDefault(); chooseSuggestion(suggestIndex >= 0 ? suggestIndex : 0); }
    else if (e.key === 'Escape') { hideSuggestions(); }
  });
  function highlightSuggest() {
    if (!suggestBox) return;
    [...suggestBox.children].forEach((el, i) => el.classList.toggle('active', i === suggestIndex));
  }
  suggestBox?.addEventListener('mousedown', (e) => {
    const btn = e.target.closest('[data-index]');
    if (!btn) return;
    chooseSuggestion(Number(btn.dataset.index));
  });
  document.addEventListener('click', (e) => {
    if (!suggestBox) return;
    if (!suggestBox.contains(e.target) && e.target !== cityInput) hideSuggestions();
  });
  function chooseSuggestion(i) {
    const p = suggestItems[i]; if (!p) return;
    const label = formatPlace(p);
    if (cityInput) cityInput.value = label;
    hideSuggestions();
    fetchWeather({ lat: p.lat, lon: p.lon, label });
  }

  // ===================== EVENTS =====================
  searchBtn?.addEventListener('click', () => {
    const q = cityInput?.value.trim();
    if (!q) return;
    if (suggestItems.length && !suggestBox?.classList.contains('d-none')) {
      chooseSuggestion(0);
    } else {
      fetchWeather({ city: q }); // will work, but may be ambiguous
    }
  });

  cityInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = cityInput.value.trim();
      if (!q) return;
      if (suggestItems.length && !suggestBox?.classList.contains('d-none')) {
        chooseSuggestion(0);
      } else {
        fetchWeather({ city: q });
      }
    }
  });

  unitSelect?.addEventListener('change', () => {
    if (currentCoords) fetchWeather({ lat: currentCoords.lat, lon: currentCoords.lon, label: currentCityLabel });
    else if (currentCityLabel) fetchWeather({ city: currentCityLabel });
  });

  // Geolocation with secure-origin check + IP fallback
  geoBtn?.addEventListener('click', () => {
    if (!('geolocation' in navigator)) return showAlert('Geolocation is not supported by your browser.', 'danger');

    const isSecure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!isSecure) return showAlert('Location requires HTTPS or localhost. Run on http://localhost:3000 or deploy over HTTPS.', 'danger');

    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const { latitude: lat, longitude: lon } = coords;
        let label = null;
        try {
          const r = await fetch(`/api/revgeo?lat=${lat}&lon=${lon}`);
          const j = await r.json();
          if (j && j.name) label = [j.name, j.state, j.country].filter(Boolean).join(', ');
          if (cityInput && label) cityInput.value = label;
        } catch {}
        fetchWeather({ lat, lon, label });
      },
      (err) => {
        const codeMsg = { 1: 'Permission denied — allow location.', 2: 'Position unavailable.', 3: 'Timeout — try again.' };
        showAlert(`Couldn’t get your location: ${codeMsg[err.code] || err.message}`, 'danger');
        // Optional approximate fallback
        fetch('https://ipapi.co/json/')
          .then(r => r.ok ? r.json() : Promise.reject())
          .then(d => { if (d?.latitude && d?.longitude) fetchWeather({ lat: d.latitude, lon: d.longitude }); })
          .catch(() => {});
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
    );
  });

  saveCurrentBtn?.addEventListener('click', addCurrentToFavorites);

  // Initial render
  renderFavorites();
})();
