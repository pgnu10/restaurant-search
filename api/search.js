import { handleSearch } from "../search.js";

function parseBounds(query) {
  const { swLat, swLng, neLat, neLng } = query;
  if (!swLat || !swLng || !neLat || !neLng) return null;
  return {
    swLat: parseFloat(swLat),
    swLng: parseFloat(swLng),
    neLat: parseFloat(neLat),
    neLng: parseFloat(neLng),
  };
}

export default async function handler(req, res) {
  const { location, keyword } = req.query;
  const bounds = parseBounds(req.query);
  if ((!location && !bounds) || !keyword) {
    return res
      .status(400)
      .json({ error: "location 또는 bounds와 keyword가 필요합니다." });
  }

  try {
    const result = await handleSearch(location || "", keyword, { bounds });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
