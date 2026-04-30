import "dotenv/config";
import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  searchPlaces,
  fetchAllMenus,
  searchSubwayStations,
  computeOutlierBounds,
} from "./search.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.static(join(__dirname, "public")));

app.get("/api/search", async (req, res) => {
  const { location, keyword } = req.query;
  if (!location || !keyword) {
    return res.status(400).json({ error: "location과 keyword가 필요합니다." });
  }

  try {
    const places = await searchPlaces(location, keyword);
    if (places.length === 0) {
      return res.json({
        location,
        keyword,
        places: [],
        stations: [],
        iqr: { lower: 0, upper: Infinity },
      });
    }

    const [results, stations] = await Promise.all([
      fetchAllMenus(places),
      searchSubwayStations(location),
    ]);

    const iqr = computeOutlierBounds(results, keyword);

    const filtered = [];
    for (const r of results) {
      const matched = r.menus.filter((m) => m.name.includes(keyword));
      if (matched.length === 0) continue;
      matched.sort((a, b) => {
        if (!a.price && !b.price) return 0;
        if (!a.price) return 1;
        if (!b.price) return -1;
        return a.price - b.price;
      });
      filtered.push({ ...r, matchedMenus: matched });
    }

    res.json({ location, keyword, places: filtered, stations, iqr });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`서버 시작: http://localhost:${PORT}`);
});
