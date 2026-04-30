import "dotenv/config";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { resolve } from "path";
import { resolveAlias, expandKeyword } from "./aliases.js";
import {
  logSearch,
  getCachedMenus,
  setCachedMenus,
  getCachedSearch,
  setCachedSearch,
} from "./db.js";
import { getFranchiseMenus } from "./franchises.js";

const KAKAO_API_KEY = process.env.KAKAO_REST_API_KEY;
const KAKAO_HEADERS = KAKAO_API_KEY ? { Authorization: `KakaoAK ${KAKAO_API_KEY}` } : {};

const PANEL3_HEADERS = {
  "User-Agent": "Mozilla/5.0",
  Referer: "https://place.map.kakao.com/",
  pf: "PC",
};

async function kakaoFetch(url) {
  if (!KAKAO_API_KEY) throw new Error("KAKAO_REST_API_KEY가 .env에 설정되지 않았습니다.");
  const res = await fetch(url, { headers: KAKAO_HEADERS });
  if (!res.ok) throw new Error(`Kakao API error ${res.status}`);
  return res.json();
}

async function locationToCoords(location) {
  const encoded = encodeURIComponent(location);
  const data = await kakaoFetch(
    `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encoded}&size=1`
  );
  if (data.documents?.length > 0) {
    const doc = data.documents[0];
    return { x: doc.x, y: doc.y };
  }
  return null;
}

async function searchPlaces(location, keyword, { radius = 2000, maxPages = 3, coords: preCoords } = {}) {
  const coords = preCoords || await locationToCoords(location);
  if (!coords) throw new Error(`"${location}" 위치를 찾을 수 없습니다.`);

  const allPlaces = [];
  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({
      query: keyword,
      category_group_code: "FD6",
      x: coords.x,
      y: coords.y,
      radius: String(radius),
      sort: "distance",
      size: "15",
      page: String(page),
    });
    const data = await kakaoFetch(
      `https://dapi.kakao.com/v2/local/search/keyword.json?${params}`
    );
    allPlaces.push(...(data.documents || []));
    if (data.meta.is_end) break;
  }
  return allPlaces;
}

async function searchSubwayStations(location, radius = 3000) {
  const coords = await locationToCoords(location);
  if (!coords) return [];

  const params = new URLSearchParams({
    category_group_code: "SW8",
    x: coords.x,
    y: coords.y,
    radius: String(radius),
    sort: "distance",
    size: "15",
  });
  const data = await kakaoFetch(
    `https://dapi.kakao.com/v2/local/search/category.json?${params}`
  );
  return (data.documents || []).map((d) => ({
    name: d.place_name,
    lat: parseFloat(d.y),
    lng: parseFloat(d.x),
  }));
}

function extractMenus(panelData) {
  if (!panelData?.menu) return [];

  const { menus, yogiyo_menus } = panelData.menu;
  const result = [];

  if (yogiyo_menus?.items?.length) {
    for (const item of yogiyo_menus.items) {
      result.push({ name: item.name, price: item.price });
    }
  }

  if (menus?.items?.length) {
    const existingNames = new Set(result.map((r) => r.name));
    for (const item of menus.items) {
      if (!existingNames.has(item.name)) {
        result.push({ name: item.name, price: item.price > 0 ? item.price : null });
      }
    }
  }

  return result;
}

async function fetchPlaceMenusFresh(placeId) {
  try {
    const res = await fetch(
      `https://place-api.map.kakao.com/places/panel3/${placeId}`,
      { headers: PANEL3_HEADERS }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const menus = extractMenus(data);
    if (menus.length > 0) setCachedMenus(placeId, menus).catch(() => {});
    return menus;
  } catch {
    return [];
  }
}

async function fetchPlaceMenus(placeId) {
  const cached = await getCachedMenus(placeId).catch(() => null);
  if (!cached) return fetchPlaceMenusFresh(placeId);

  if (cached.status === "fresh") return cached.menus;

  if (cached.status === "stale") {
    fetchPlaceMenusFresh(placeId);
    return cached.menus;
  }

  return fetchPlaceMenusFresh(placeId);
}

async function fetchAllMenus(places, { concurrency = 10, onProgress } = {}) {
  const results = [];
  for (let i = 0; i < places.length; i += concurrency) {
    const batch = places.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (place) => {
        let menus = await fetchPlaceMenus(place.id);
        if (menus.length === 0) {
          menus = getFranchiseMenus(place.place_name) || [];
        }
        return {
          name: place.place_name,
          address: place.road_address_name || place.address_name,
          phone: place.phone,
          url: place.place_url,
          lat: parseFloat(place.y),
          lng: parseFloat(place.x),
          menus,
        };
      })
    );
    results.push(...batchResults);
    onProgress?.(Math.min(i + concurrency, places.length), places.length);
  }
  return results;
}

function computeOutlierBounds(results, keywords) {
  const kws = Array.isArray(keywords) ? keywords : keywords ? [keywords] : [];
  const matchMenu = kws.length > 0
    ? (name) => kws.some((kw) => name.includes(kw))
    : () => true;
  const prices = [];
  for (const r of results) {
    const matched = r.menus.filter((m) => matchMenu(m.name));
    for (const m of matched) {
      if (m.price > 0) prices.push(m.price);
    }
  }
  if (prices.length < 4) return { lower: 0, upper: Infinity };

  prices.sort((a, b) => a - b);
  const q1 = prices[Math.floor(prices.length * 0.25)];
  const q3 = prices[Math.floor(prices.length * 0.75)];
  const iqr = q3 - q1;
  return { lower: Math.max(0, q1 - 1.5 * iqr), upper: q3 + 1.5 * iqr };
}

function computeBoundsRadius(bounds) {
  const toRad = (d) => (d * Math.PI) / 180;
  const lat1 = toRad(bounds.swLat), lat2 = toRad(bounds.neLat);
  const dLat = lat2 - lat1;
  const dLng = toRad(bounds.neLng - bounds.swLng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const dist = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(dist / 2);
}

async function handleSearch(rawLocation, keyword, { bounds, onProgress } = {}) {
  const startTime = Date.now();
  const resolvedLocation = resolveAlias(rawLocation);

  if (!onProgress) {
    const cached = await getCachedSearch(resolvedLocation, keyword, bounds).catch(() => null);
    if (cached) {
      logSearch({
        raw_query: (rawLocation || "") + " " + keyword,
        location: resolvedLocation || "",
        keyword,
        result_count: cached.places.length,
        zero_result: cached.places.length === 0,
        duration_ms: Date.now() - startTime,
      }).catch(() => {});
      return cached;
    }
  }

  let searchCoords, searchRadius;
  if (bounds) {
    searchCoords = {
      x: String((bounds.swLng + bounds.neLng) / 2),
      y: String((bounds.swLat + bounds.neLat) / 2),
    };
    searchRadius = Math.min(computeBoundsRadius(bounds), 20000);
  }

  onProgress?.("places", 0, 0);

  let places = await searchPlaces(resolvedLocation, keyword, {
    coords: searchCoords,
    radius: searchRadius || 2000,
  });

  if (places.length === 0 && !bounds) {
    places = await searchPlaces(resolvedLocation, keyword, { radius: 5000 });
  }

  if (places.length === 0) {
    const duration = Date.now() - startTime;
    logSearch({
      raw_query: (rawLocation || "") + " " + keyword,
      location: resolvedLocation || "",
      keyword,
      result_count: 0,
      zero_result: true,
      duration_ms: duration,
    }).catch(() => {});
    return {
      location: resolvedLocation || "",
      keyword,
      places: [],
      stations: [],
      iqr: { lower: 0, upper: Infinity },
    };
  }

  const menuProgress = (done, total) => onProgress?.("menus", done, total);

  const stationLocation = resolvedLocation || rawLocation;
  const [results, stations] = await Promise.all([
    fetchAllMenus(places, { onProgress: menuProgress }),
    stationLocation ? searchSubwayStations(stationLocation) : Promise.resolve([]),
  ]);

  onProgress?.("sorting", 0, 0);

  const keywords = expandKeyword(keyword);
  const matchMenu = (name) => keywords.some((kw) => name.includes(kw));

  const iqr = computeOutlierBounds(results, keywords);

  const filtered = [];
  for (const r of results) {
    const matched = r.menus.filter((m) => matchMenu(m.name));
    if (matched.length === 0) continue;
    matched.sort((a, b) => {
      if (!a.price && !b.price) return 0;
      if (!a.price) return 1;
      if (!b.price) return -1;
      return a.price - b.price;
    });
    filtered.push({ ...r, matchedMenus: matched });
  }

  const duration = Date.now() - startTime;
  logSearch({
    raw_query: (rawLocation || "") + " " + keyword,
    location: resolvedLocation || "",
    keyword,
    result_count: filtered.length,
    zero_result: filtered.length === 0,
    duration_ms: duration,
  }).catch(() => {});

  const result = {
    location: resolvedLocation || "",
    keyword,
    places: filtered,
    stations,
    iqr,
  };

  setCachedSearch(resolvedLocation, keyword, bounds, result).catch(() => {});

  return result;
}

export {
  searchPlaces,
  fetchAllMenus,
  searchSubwayStations,
  computeOutlierBounds,
  handleSearch,
};

// --- CLI: CSV Output ---

function escapeCsv(str) {
  if (!str) return "";
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildRows(keyword, results) {
  const bounds = computeOutlierBounds(results, keyword);
  const rows = [];
  for (const r of results) {
    const matched = keyword ? r.menus.filter((m) => m.name.includes(keyword)) : r.menus;
    if (matched.length === 0) continue;
    for (const m of matched) {
      const outlier = m.price > 0 && (m.price < bounds.lower || m.price > bounds.upper);
      rows.push({
        가게명: r.name,
        주소: r.address || "",
        전화: r.phone || "",
        메뉴명: m.name,
        가격: m.price > 0 ? m.price : "",
        제외: outlier ? "Y" : "",
        카카오맵: r.url || "",
      });
    }
  }
  rows.sort((a, b) => {
    if (a.제외 !== b.제외) return a.제외 ? 1 : -1;
    if (!a.가격 && !b.가격) return 0;
    if (!a.가격) return 1;
    if (!b.가격) return -1;
    return a.가격 - b.가격;
  });
  return rows;
}

function printCsv(keyword, results) {
  const rows = buildRows(keyword, results);
  if (rows.length === 0) {
    console.error(
      keyword ? `"${keyword}" 키워드에 해당하는 메뉴가 없습니다.` : "메뉴 정보가 없습니다."
    );
    process.exit(0);
  }

  const headers = Object.keys(rows[0]);
  console.log(headers.join(","));
  for (const row of rows) {
    console.log(headers.map((h) => escapeCsv(String(row[h]))).join(","));
  }
}

// --- CLI: HTML Output ---

function generateHtml(location, keyword, results, stations = []) {
  const iqrBounds = computeOutlierBounds(results, keyword);

  const placesWithMenus = [];
  for (const r of results) {
    const matched = keyword ? r.menus.filter((m) => m.name.includes(keyword)) : r.menus;
    if (matched.length === 0) continue;
    matched.sort((a, b) => {
      if (!a.price && !b.price) return 0;
      if (!a.price) return 1;
      if (!b.price) return -1;
      return a.price - b.price;
    });
    placesWithMenus.push({ ...r, matchedMenus: matched });
  }

  const data = JSON.stringify(placesWithMenus);
  const stationData = JSON.stringify(stations);
  const iqrData = JSON.stringify(iqrBounds);

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${location} ${keyword} 가격 비교</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, 'Malgun Gothic', sans-serif; display: flex; height: 100vh; }
#sidebar {
  width: 400px; min-width: 400px; height: 100vh; overflow-y: auto;
  border-right: 1px solid #ddd; background: #fafafa;
}
#sidebar-header {
  position: sticky; top: 0; z-index: 10; background: #2c3e50; color: #fff;
  padding: 16px 20px;
}
#sidebar-header h1 { font-size: 18px; margin-bottom: 4px; }
#sidebar-header .summary { font-size: 13px; opacity: .8; margin-bottom: 10px; }
#price-filter { background: #3a5268; border-radius: 8px; padding: 10px 12px; }
#price-filter label { font-size: 12px; opacity: .8; display: block; margin-bottom: 6px; }
.filter-row { display: flex; align-items: center; gap: 8px; }
.filter-row input {
  width: 90px; padding: 4px 8px; border: none; border-radius: 4px;
  font-size: 13px; text-align: right; background: #fff; color: #333;
}
.filter-row span { font-size: 13px; opacity: .7; }
.filter-row button {
  margin-left: auto; padding: 4px 10px; border: 1px solid rgba(255,255,255,.4);
  border-radius: 4px; background: transparent; color: #fff; font-size: 11px; cursor: pointer;
}
.filter-row button:hover { background: rgba(255,255,255,.15); }
.place-card {
  padding: 14px 20px; border-bottom: 1px solid #eee; cursor: pointer; transition: background .15s;
}
.place-card:hover, .place-card.active { background: #e8f4fd; }
.place-name {
  font-size: 15px; font-weight: 700; color: #2c3e50; margin-bottom: 2px;
  display: flex; align-items: center; gap: 8px;
}
.place-rank {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 50%; font-size: 11px; font-weight: 800;
  color: #fff; flex-shrink: 0;
}
.rank-1 { background: #e74c3c; } .rank-2 { background: #e67e22; }
.rank-3 { background: #f1c40f; color: #333; } .rank-n { background: #95a5a6; }
.place-addr { font-size: 12px; color: #888; margin-bottom: 6px; }
.place-link { font-size: 12px; color: #3498db; text-decoration: none; }
.place-link:hover { text-decoration: underline; }
.menu-table { width: 100%; border-collapse: collapse; margin-top: 6px; }
.menu-table td { padding: 3px 0; font-size: 13px; color: #444; vertical-align: top; }
.menu-table td:last-child { text-align: right; font-weight: 600; white-space: nowrap; }
.menu-table tr.cheapest td { color: #e74c3c; font-weight: 700; }
.menu-table tr.outlier td { color: #bbb; text-decoration: line-through; }
.outlier-tag {
  display: inline-block; font-size: 10px; color: #999; background: #f0f0f0;
  padding: 0 5px; border-radius: 3px; margin-left: 4px;
  text-decoration: none; vertical-align: middle;
}
#map { flex: 1; height: 100vh; }
.marker-dot {
  width: 28px; height: 28px; border-radius: 50%; line-height: 28px; text-align: center;
  font-size: 12px; font-weight: 800; color: #fff;
  box-shadow: 0 2px 6px rgba(0,0,0,.35); cursor: pointer; transition: transform .15s;
}
.marker-dot:hover { transform: scale(1.3); }
.dot-1 { background: #e74c3c; } .dot-2 { background: #e67e22; }
.dot-3 { background: #f39c12; } .dot-n { background: #5a6c7d; }
.station-label {
  display: flex; align-items: center; gap: 4px;
  background: #fff; color: #1a3a8a; padding: 3px 10px; border-radius: 14px;
  font-size: 13px; font-weight: 800; white-space: nowrap;
  border: 2px solid #3b5fc0; box-shadow: 0 1px 4px rgba(0,0,0,.25);
}
.station-icon {
  display: inline-block; width: 16px; height: 16px; border-radius: 50%;
  background: #3b5fc0; color: #fff; font-size: 10px; font-weight: 900;
  line-height: 16px; text-align: center; flex-shrink: 0;
}
.leaflet-tooltip {
  font-family: -apple-system, 'Malgun Gothic', sans-serif;
  padding: 8px 12px; font-size: 13px; line-height: 1.5;
  max-width: 280px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,.2);
}
</style>
</head>
<body>
<div id="sidebar">
  <div id="sidebar-header">
    <h1>${location} "${keyword}" 가격 비교</h1>
    <div class="summary" id="summary"></div>
    <div id="price-filter">
      <label>가격 필터 (순위 계산 범위)</label>
      <div class="filter-row">
        <input type="number" id="minPrice" step="1000" />
        <span>~</span>
        <input type="number" id="maxPrice" step="1000" />
        <span>원</span>
        <button id="resetFilter">IQR 초기화</button>
      </div>
    </div>
  </div>
  <div id="place-list"></div>
</div>
<div id="map"></div>
<script>
const places = ${data};
const stations = ${stationData};
const iqr = ${iqrData};
const map = L.map('map');
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
  maxZoom: 19, attribution: '\\u00a9 OpenStreetMap contributors \\u00a9 CARTO'
}).addTo(map);
const priceStr = (p) => p > 0 ? p.toLocaleString('ko-KR') + '원' : '-';
const listEl = document.getElementById('place-list');
const summaryEl = document.getElementById('summary');
const minInput = document.getElementById('minPrice');
const maxInput = document.getElementById('maxPrice');
const resetBtn = document.getElementById('resetFilter');
const mapBounds = L.latLngBounds();
const markerLayer = L.layerGroup().addTo(map);
const latlngs = {};
places.forEach(p => { const ll = L.latLng(p.lat, p.lng); latlngs[p.name] = ll; mapBounds.extend(ll); });
stations.forEach(s => {
  const icon = L.divIcon({ className: '',
    html: '<div class="station-label"><span class="station-icon">M</span>' + s.name + '</div>',
    iconAnchor: [14, 14] });
  L.marker([s.lat, s.lng], { icon, interactive: false, zIndexOffset: -1000 }).addTo(map);
});
if (mapBounds.isValid()) map.fitBounds(mapBounds, { padding: [40, 40] });
minInput.value = Math.floor(iqr.lower / 1000) * 1000;
maxInput.value = Math.ceil(iqr.upper / 1000) * 1000;
function renderAll() {
  const lo = Number(minInput.value) || 0;
  const hi = Number(maxInput.value) || Infinity;
  const ranked = places.map(p => {
    const menus = p.matchedMenus.map(m => ({ ...m, outlier: m.price > 0 && (m.price < lo || m.price > hi) }));
    const cheapest = menus.find(m => m.price > 0 && !m.outlier);
    return { ...p, menus, cheapest, cheapestPrice: cheapest?.price ?? Infinity };
  });
  ranked.sort((a, b) => a.cheapestPrice - b.cheapestPrice);
  const totalMenus = ranked.reduce((s, p) => s + p.menus.length, 0);
  const excluded = ranked.reduce((s, p) => s + p.menus.filter(m => m.outlier).length, 0);
  summaryEl.innerHTML = ranked.length + '개 매장 / ' + totalMenus + '개 메뉴' +
    (excluded ? '<br><span style="font-size:11px">' + excluded + '건 범위 밖 제외</span>' : '');
  listEl.innerHTML = '';
  markerLayer.clearLayers();
  ranked.forEach((p, idx) => {
    const rank = idx + 1;
    const rankClass = rank <= 3 ? 'rank-' + rank : 'rank-n';
    const menuRows = p.menus.map(m => {
      const isCheapest = p.cheapest && m.name === p.cheapest.name && m.price === p.cheapest.price;
      const cls = m.outlier ? 'outlier' : isCheapest ? 'cheapest' : '';
      return '<tr class="' + cls + '"><td>' + m.name +
        (m.outlier ? ' <span class="outlier-tag">제외</span>' : '') +
        '</td><td>' + priceStr(m.price) + '</td></tr>';
    }).join('');
    const card = document.createElement('div');
    card.className = 'place-card';
    card.innerHTML =
      '<div class="place-name"><span class="place-rank ' + rankClass + '">' + rank + '</span>' + p.name + '</div>' +
      '<div class="place-addr">' + (p.address || '') + (p.phone ? ' | ' + p.phone : '') + '</div>' +
      '<table class="menu-table">' + menuRows + '</table>' +
      (p.url ? '<a class="place-link" href="' + p.url + '" target="_blank">카카오맵에서 보기</a>' : '');
    listEl.appendChild(card);
    const latlng = latlngs[p.name];
    const dotClass = rank <= 3 ? 'dot-' + rank : 'dot-n';
    const icon = L.divIcon({ className: '',
      html: '<div class="marker-dot ' + dotClass + '">' + rank + '</div>',
      iconSize: [28, 28], iconAnchor: [14, 14] });
    const validMenus = p.menus.filter(m => !m.outlier);
    const tooltipHtml = '<b>' + p.name + '</b>' +
      (p.cheapest ? ' <span style="color:#e74c3c">' + priceStr(p.cheapest.price) + '~</span>' : '') +
      '<br><span style="color:#888;font-size:11px">' + (p.address || '') + '</span>' +
      '<hr style="margin:4px 0;border:none;border-top:1px solid #eee">' +
      validMenus.map(m => {
        const style = p.cheapest && m.name === p.cheapest.name && m.price === p.cheapest.price
          ? 'color:#e74c3c;font-weight:700' : '';
        return '<span style="' + style + '">' + m.name + ' <b>' + priceStr(m.price) + '</b></span>';
      }).join('<br>');
    const marker = L.marker(latlng, { icon }).addTo(markerLayer);
    marker.bindTooltip(tooltipHtml, { direction: 'top', offset: [0, -14] });
    card.addEventListener('click', () => {
      map.setView(latlng, 17); marker.openTooltip();
      document.querySelectorAll('.place-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
    });
    marker.on('click', () => {
      document.querySelectorAll('.place-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
}
minInput.addEventListener('change', renderAll);
maxInput.addEventListener('change', renderAll);
resetBtn.addEventListener('click', () => {
  minInput.value = Math.floor(iqr.lower / 1000) * 1000;
  maxInput.value = Math.ceil(iqr.upper / 1000) * 1000;
  renderAll();
});
renderAll();
<\/script>
</body>
</html>`;
}

// --- CLI Main ---

async function main() {
  if (!KAKAO_API_KEY) {
    console.error("KAKAO_REST_API_KEY가 .env에 설정되지 않았습니다.");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const htmlFlag = args.includes("--html");
  const positional = args.filter((a) => !a.startsWith("--"));
  const location = positional[0];
  const keyword = positional[1];

  if (!location || !keyword) {
    console.error('사용법: node search.js "위치" "메뉴키워드" [--html]');
    console.error("");
    console.error("  CSV:  node search.js 사당역 보쌈");
    console.error("  HTML: node search.js 사당역 보쌈 --html");
    process.exit(1);
  }

  console.error(`"${location}" 근처 "${keyword}" 검색 중...`);

  const places = await searchPlaces(location, keyword);
  if (places.length === 0) {
    console.error("검색 결과가 없습니다.");
    process.exit(0);
  }

  console.error(`${places.length}개 음식점 발견. 메뉴 정보 수집 중...`);
  const results = await fetchAllMenus(places, {
    onProgress: (done, total) => console.error(`  ${done}/${total}...`),
  });

  if (htmlFlag) {
    const stations = await searchSubwayStations(location);
    const html = generateHtml(location, keyword, results, stations);
    const filename = "result.html";
    writeFileSync(filename, html, "utf-8");
    console.error(`\n${filename} 생성 완료. 브라우저에서 열어주세요.`);
  } else {
    printCsv(keyword, results);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("오류:", err.message);
    process.exit(1);
  });
}
