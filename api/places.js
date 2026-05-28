const https = require("https");

function httpsPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: "POST",
      headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => resolve(JSON.parse(data)));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body) return resolve(req.body);
    let data = "";
    req.on("data", (chunk) => data += chunk);
    req.on("end", () => {
      try { resolve(JSON.parse(data)); }
      catch (e) { resolve({}); }
    });
    req.on("error", reject);
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API key not configured" });

  try {
    const parsed = await parseBody(req);
    const { textQuery, locationBias, maxResultCount } = parsed;
    const body = JSON.stringify({ textQuery, locationBias, maxResultCount });
    const data = await httpsPost(
      "https://places.googleapis.com/v1/places:searchText",
      {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.regularOpeningHours,places.businessStatus",
      },
      body
    );
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: "Places search failed", detail: err.message });
  }
};
