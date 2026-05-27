export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { q } = req.query;
  if (!q) return res.status(400).json({ error: "Missing query" });

  const apiKey = process.env.GOOGLE_API_KEY;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${apiKey}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    if (data.status !== "OK" || !data.results[0]) {
      return res.status(404).json({ error: "Location not found" });
    }
    const { lat, lng } = data.results[0].geometry.location;
    const label = data.results[0].formatted_address.split(",").slice(0, 3).join(",").trim();
    return res.status(200).json({ lat, lng, label });
  } catch (err) {
    return res.status(500).json({ error: "Geocoding failed" });
  }
}
