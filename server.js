import "dotenv/config";
import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { handleSearch } from "./search.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.static(join(__dirname, "public"), { maxAge: "1h" }));

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

app.get("/api/search", async (req, res) => {
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
});

app.get("/api/search/stream", async (req, res) => {
  const { location, keyword } = req.query;
  const bounds = parseBounds(req.query);
  if ((!location && !bounds) || !keyword) {
    res.status(400).json({ error: "location 또는 bounds와 keyword가 필요합니다." });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const result = await handleSearch(location || "", keyword, {
      bounds,
      onProgress: (phase, current, total) => {
        send("progress", { phase, current, total });
      },
    });
    send("done", result);
  } catch (err) {
    send("error", { message: err.message });
  }
  res.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`서버 시작: http://localhost:${PORT}`);
});
