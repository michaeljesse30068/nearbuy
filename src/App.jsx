import { useState, useRef, useEffect, useCallback } from "react";

// Google Maps JS API key (Maps display only - Places/Geocoding go through backend proxy)
const GOOGLE_API_KEY = "AIzaSyBNh3_TS9nwiVk7jjUlk97p5PkRxTdW61U";

const CATEGORY_TO_SEARCHES = {
  Kitchen: ["kitchen supply store", "cookware store", "home goods store"],
  Home: ["home goods store", "linen store", "bed bath store"],
  Clothing: ["clothing store", "outdoor clothing store", "sporting goods store"],
  Electronics: ["electronics store", "computer store"],
  Garden: ["garden center", "nursery", "hardware store"],
  Food: ["grocery store", "specialty food store", "farmers market"],
  Beauty: ["beauty supply store", "pharmacy", "apothecary"],
  Sports: ["sporting goods store", "outdoor gear store"],
  Other: ["general store", "department store"],
};

const BIG_BOX_NAMES = ["target", "walmart", "costco", "sam's club", "kmart", "meijer", "big lots", "dollar general", "dollar tree", "family dollar"];
const CHAIN_NAMES = ["rei", "bed bath", "home depot", "lowe's", "tj maxx", "marshalls", "ross", "nordstrom", "macy's", "best buy", "gap", "old navy", "container store", "crate", "pottery barn", "west elm", "williams sonoma", "world market"];

function classifyStore(name) {
  const lower = name.toLowerCase();
  if (BIG_BOX_NAMES.some(n => lower.includes(n))) return "big-box";
  if (CHAIN_NAMES.some(n => lower.includes(n))) return "chain";
  return "mom-and-pop";
}

function storeColor(type) {
  return type === "mom-and-pop" ? "#5C4A2A" : type === "chain" ? "#2C4A3E" : "#3A3A4A";
}

function storeMarkerColor(type) {
  return type === "mom-and-pop" ? "0x5C4A2Aff" : type === "chain" ? "0x2C4A3Eff" : "0x3A3A4Aff";
}

const STEPS = ["import", "preferences", "results"];
const storeTypeLabel = { "mom-and-pop": "Local", chain: "Chain", "big-box": "Big Box" };

function distanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchNearbyStores(lat, lng, items, maxDistanceMiles) {
  const categories = [...new Set(items.map(i => i.category))];
  const searchQueries = categories.flatMap(c => (CATEGORY_TO_SEARCHES[c] || ["general store"]).slice(0, 1));
  const uniqueQueries = [...new Set(searchQueries)];
  const radiusMeters = Math.min(maxDistanceMiles * 1609, 50000);
  const placeMap = new Map();

  await Promise.all(uniqueQueries.map(async (query) => {
    try {
      const res = await fetch("/api/places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          textQuery: query,
          locationBias: { circle: { center: { latitude: lat, longitude: lng }, radiusMeters } },
          maxResultCount: 8,
        }),
      });
      const data = await res.json();
      if (data.places) {
        data.places.forEach(p => {
          if (!placeMap.has(p.id) && p.businessStatus === "OPERATIONAL") placeMap.set(p.id, p);
        });
      }
    } catch (e) {}
  }));

  const stores = [];
  for (const p of placeMap.values()) {
    if (!p.location) continue;
    const dist = distanceMiles(lat, lng, p.location.latitude, p.location.longitude);
    if (dist > maxDistanceMiles) continue;
    const name = p.displayName?.text || "Unknown Store";
    const type = classifyStore(name);
    stores.push({
      id: p.id,
      name,
      type,
      distance: Math.round(dist * 10) / 10,
      address: p.formattedAddress || "",
      rating: p.rating || null,
      reviews: p.userRatingCount || 0,
      hours: p.regularOpeningHours?.weekdayDescriptions?.slice(0, 2).join(", ") || "",
      lat: p.location.latitude,
      lng: p.location.longitude,
      matches: [],
      alternatives: {},
      savings: 0,
      color: storeColor(type),
      markerColor: storeMarkerColor(type),
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}&query_place_id=${p.id}`,
    });
  }
  if (stores.length === 0) {
    // Preview fallback: generate plausible mock stores near the given coordinates
    const mockTemplates = [
      { name: "The Kitchen Collective", type: "mom-and-pop", ratingBase: 4.8, reviewsBase: 240, hoursNote: "Tue–Sun 10–6" },
      { name: "Hearth & Home Supply", type: "mom-and-pop", ratingBase: 4.6, reviewsBase: 180, hoursNote: "Mon–Sat 9–7" },
      { name: "Local Goods Market", type: "mom-and-pop", ratingBase: 4.7, reviewsBase: 310, hoursNote: "Daily 10–6" },
      { name: "REI Co-op", type: "chain", ratingBase: 4.5, reviewsBase: 3200, hoursNote: "Daily 10–8" },
      { name: "Williams-Sonoma", type: "chain", ratingBase: 4.3, reviewsBase: 890, hoursNote: "Daily 10–8" },
      { name: "Target", type: "big-box", ratingBase: 3.9, reviewsBase: 7400, hoursNote: "Daily 8–10" },
      { name: "Walmart", type: "big-box", ratingBase: 3.7, reviewsBase: 5200, hoursNote: "Daily 7–11" },
    ];
    const offsets = [[0.008, 0.012], [0.015, -0.008], [-0.010, 0.018], [0.022, 0.005], [-0.018, -0.014], [0.030, 0.025], [-0.028, 0.032]];
    mockTemplates.forEach((t, i) => {
      const [dlat, dlng] = offsets[i];
      const slat = lat + dlat, slng = lng + dlng;
      const dist = Math.round(distanceMiles(lat, lng, slat, slng) * 10) / 10;
      if (dist > maxDistanceMiles) return;
      stores.push({
        id: `mock-${i}`, name: t.name, type: t.type,
        distance: dist, address: `Near ${lat.toFixed(3)}, ${lng.toFixed(3)}`,
        rating: t.ratingBase, reviews: t.reviewsBase, hours: t.hoursNote,
        lat: slat, lng: slng, matches: [], alternatives: {}, savings: 0,
        color: storeColor(t.type), markerColor: storeMarkerColor(t.type),
        mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t.name + " " + lat + " " + lng)}`,
      });
    });
  }
  return stores.sort((a, b) => a.distance - b.distance).slice(0, 12);
}

async function geocodeLocation(query) {
  const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error("Location not found. Try a city name or zip code.");
  const data = await res.json();
  if (data.error) throw new Error("Location not found. Try a city name or zip code.");
  return data;
}

// --- Impact Calculator ---
function calcImpact(items, bestStore, cityName) {
  const itemCount = items.length;
  const cartTotal = items.reduce((s, i) => s + i.price, 0);
  const distMi = bestStore?.distance || 1.5;
  const boxCount = Math.max(1, Math.round(itemCount / 2.5));
  const shippingCO2kg = boxCount * (0.6 * 0.5 + 0.4 * 2.5);
  const drivingCO2kg = distMi * 2 * 0.000158;
  const netCO2kg = Math.max(0, shippingCO2kg - drivingCO2kg);
  const netCO2lbs = (netCO2kg * 2.205).toFixed(1);
  const tvHours = Math.round(netCO2kg / 0.072);
  const phoneCharges = Math.round(netCO2kg / 0.008);
  const drivingMilesEquiv = Math.round(netCO2kg / 0.000158 / 2);
  const localEconomicImpact = (cartTotal * 2.5).toFixed(0);
  const plasticBags = boxCount * 3;
  return { co2Avoided: netCO2lbs, boxCount, tvHours, phoneCharges, drivingMilesEquiv, localEconomicImpact, plasticBags, cartTotal: cartTotal.toFixed(0), cityName: cityName || "your city", storeName: bestStore?.name || "this store", distMi };
}
async function matchItemsToStores(stores, items) {
  if (!stores.length || !items.length) return stores;
  const prompt = `You are helping a shopper find local alternatives to online cart items.

Cart items:
${items.map((item, i) => `${i + 1}. "${item.name}" (${item.category}, $${item.price})`).join("\n")}

Nearby stores:
${stores.map((s, i) => `${i + 1}. "${s.name}" (${s.type}, ${s.distance} miles)`).join("\n")}

For each store, reason about which cart items it would likely carry.

Respond ONLY with a JSON array, one object per store in the same order:
[{"storeIndex":0,"matchedItemIndexes":[0,2],"alternatives":{"1":"Alternative — ~$XX"},"estimatedSavings":2.50}]

matchedItemIndexes: 0-based indexes of items this store likely stocks.
alternatives: 0-based item indexes (as strings) for similar alternatives at this store.
estimatedSavings: rough $ difference (positive = cheaper locally).
Return only valid JSON.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "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",
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await res.json();
    const text = data.content.find(b => b.type === "text")?.text || "[]";
    const matches = JSON.parse(text.replace(/```json|```/g, "").trim());
    return stores.map((store, si) => {
      const m = matches.find(x => x.storeIndex === si);
      if (!m) return store;
      const matchedIds = (m.matchedItemIndexes || []).map(idx => items[idx]?.id).filter(Boolean);
      const altObj = {};
      Object.entries(m.alternatives || {}).forEach(([idx, desc]) => {
        const item = items[parseInt(idx)];
        if (item) altObj[item.id] = desc;
      });
      return { ...store, matches: matchedIds, alternatives: altObj, savings: m.estimatedSavings || 0 };
    });
  } catch { return stores; }
}

// Build Google Static Maps URL with store pins + user location
function buildStaticMapUrl(userLat, userLng, stores, selectedId, width = 480, height = 300) {
  const base = "https://maps.googleapis.com/maps/api/staticmap";
  const params = new URLSearchParams({
    size: `${width}x${height}`,
    scale: "2",
    maptype: "roadmap",
    key: GOOGLE_API_KEY,
    style: "feature:poi|visibility:simplified",
  });

  // User location pin (green)
  params.append("markers", `color:0x3A5A30ff|size:mid|${userLat},${userLng}`);

  // Store pins
  stores.forEach((s, i) => {
    const isSelected = s.id === selectedId;
    const color = isSelected ? "0xE8600Aff" : s.markerColor;
    const size = isSelected ? "mid" : "small";
    params.append("markers", `color:${color}|size:${size}|label:${i + 1}|${s.lat},${s.lng}`);
  });

  // Auto-center/zoom around all points
  const allLats = [userLat, ...stores.map(s => s.lat)];
  const allLngs = [userLng, ...stores.map(s => s.lng)];
  const centerLat = (Math.min(...allLats) + Math.max(...allLats)) / 2;
  const centerLng = (Math.min(...allLngs) + Math.max(...allLngs)) / 2;
  params.set("center", `${centerLat},${centerLng}`);

  return `${base}?${params.toString()}`;
}


function ImpactCard({ items, bestStore, cityName }) {
  const [expanded, setExpanded] = useState(false);
  if (!bestStore || items.length === 0) return null;
  const imp = calcImpact(items, bestStore, cityName);
  return (
    <div style={{ marginTop: 16, borderRadius: 14, overflow: "hidden", border: "1.5px solid #B8D4B0" }}>
      <div style={{ background: "linear-gradient(135deg, #2C4A2E, #3A5A30)", padding: "16px" }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#8CC878", marginBottom: 6 }}>Your NearBuy Impact</div>
        <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 17, color: "#EDF7EC", lineHeight: 1.35, marginBottom: 12 }}>Picking up at <span style={{ color: "#A8E090" }}>{imp.storeName}</span> instead of ordering online:</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {[{ value: "$" + imp.localEconomicImpact, label: "kept local", icon: "🏘️" }, { value: imp.co2Avoided + " lbs", label: "CO₂ avoided", icon: "🌿" }, { value: String(imp.boxCount), label: imp.boxCount === 1 ? "box saved" : "boxes saved", icon: "📦" }].map(({ value, label, icon }) => (
            <div key={label} style={{ background: "rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px 8px", textAlign: "center" }}>
              <div style={{ fontSize: 20, marginBottom: 2 }}>{icon}</div>
              <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 16, color: "#EDF7EC" }}>{value}</div>
              <div style={{ fontSize: 10, color: "#8CC878", marginTop: 1 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ background: "#F2F8F0" }}>
        <button onClick={() => setExpanded(e => !e)} style={{ width: "100%", padding: "10px 16px", background: "none", border: "none", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: "inherit" }}>
          <span style={{ fontSize: 12, color: "#3A6B45", fontWeight: 600 }}>What does this actually mean?</span>
          <span style={{ fontSize: 12, color: "#6A9A5E" }}>{expanded ? "▲ Less" : "▼ More"}</span>
        </button>
        {expanded && (
          <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            {[{ icon: "📺", text: "That CO₂ is like leaving a TV on for " + imp.tvHours + " hours, or charging your phone " + imp.phoneCharges + " times." }, { icon: "🚗", text: "Even after your " + imp.distMi + "-mile trip, you still avoid the emissions equivalent of driving " + imp.drivingMilesEquiv + " miles." }, { icon: "🏘️", text: "Every $1 spent locally recirculates ~$2.50 in the local economy. Your $" + imp.cartTotal + " cart could generate $" + imp.localEconomicImpact + " of economic activity in " + imp.cityName + "." }, { icon: "♻️", text: "Online orders average " + imp.plasticBags + " pieces of plastic packaging. Shopping in-store: zero." }].map(({ icon, text }) => (
              <div key={icon} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{icon}</span>
                <p style={{ margin: 0, fontSize: 13, color: "#3A4A38", lineHeight: 1.55 }}>{text}</p>
              </div>
            ))}
            <div style={{ marginTop: 4, padding: "8px 12px", background: "#E8F3E4", borderRadius: 8, fontSize: 11, color: "#5A7A52", lineHeight: 1.5 }}>Estimates based on EPA emissions data, NRDC shipping research, and ILSR local economic multiplier studies.</div>
          </div>
        )}
      </div>
    </div>
  );
}


const CATEGORIES = ["Kitchen", "Home", "Clothing", "Electronics", "Garden", "Food", "Beauty", "Sports", "Other"];

function CartItem({ item, onRemove, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item);

  const save = () => {
    onUpdate({ ...draft, price: parseFloat(draft.price) || 0, image: categoryEmoji(draft.category) });
    setEditing(false);
  };

  const categoryEmoji = (cat) => ({ Kitchen: "🍳", Home: "🏠", Clothing: "👕", Electronics: "💻", Garden: "🌱", Food: "🥘", Beauty: "✨", Sports: "⚽" }[cat] || "📦");

  if (editing) {
    return (
      <div style={{ background: "#F0F8EC", border: "1.5px solid #8CC878", borderRadius: 10, padding: "12px 14px", marginBottom: 8 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
            placeholder="Item name"
            style={{ padding: "7px 10px", borderRadius: 7, border: "1px solid #C8D8C0", fontSize: 13, fontFamily: "inherit", background: "#FDFBF7", color: "#2C2416", outline: "none" }} />
          <div style={{ display: "flex", gap: 8 }}>
            <input value={draft.brand} onChange={e => setDraft(d => ({ ...d, brand: e.target.value }))}
              placeholder="Brand"
              style={{ flex: 1, padding: "7px 10px", borderRadius: 7, border: "1px solid #C8D8C0", fontSize: 13, fontFamily: "inherit", background: "#FDFBF7", color: "#2C2416", outline: "none" }} />
            <input value={draft.price} onChange={e => setDraft(d => ({ ...d, price: e.target.value }))}
              placeholder="Price"
              type="number" min="0" step="0.01"
              style={{ width: 80, padding: "7px 10px", borderRadius: 7, border: "1px solid #C8D8C0", fontSize: 13, fontFamily: "monospace", background: "#FDFBF7", color: "#2C2416", outline: "none" }} />
          </div>
          <select value={draft.category} onChange={e => setDraft(d => ({ ...d, category: e.target.value }))}
            style={{ padding: "7px 10px", borderRadius: 7, border: "1px solid #C8D8C0", fontSize: 13, fontFamily: "inherit", background: "#FDFBF7", color: "#2C2416", outline: "none" }}>
            {CATEGORIES.map(c => <option key={c} value={c}>{categoryEmoji(c)} {c}</option>)}
          </select>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={save} style={{ flex: 1, padding: "8px", borderRadius: 7, border: "none", background: "#3A5A30", color: "#EAF3E8", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Save</button>
            <button onClick={() => { setDraft(item); setEditing(false); }} style={{ padding: "8px 14px", borderRadius: 7, border: "1px solid #C8B898", background: "transparent", color: "#6A5A4A", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "#FAF7F2", border: "1px solid #E8E0D0", borderRadius: 10, marginBottom: 8 }}>
      <span style={{ fontSize: 22 }}>{item.image}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 14, color: "#2C2416", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
        <div style={{ fontSize: 12, color: "#8C7A5E", marginTop: 2 }}>{item.brand} · {item.category}</div>
      </div>
      <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 600, color: "#4A3728", flexShrink: 0 }}>${parseFloat(item.price).toFixed(2)}</div>
      <button onClick={() => setEditing(true)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#8C7A5E", padding: "0 2px" }} title="Edit">✏️</button>
      <button onClick={() => onRemove(item.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#B09070", lineHeight: 1, padding: "0 2px" }}>×</button>
    </div>
  );
}

function AddItemRow({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ name: "", brand: "", price: "", category: "Other" });
  const categoryEmoji = (cat) => ({ Kitchen: "🍳", Home: "🏠", Clothing: "👕", Electronics: "💻", Garden: "🌱", Food: "🥘", Beauty: "✨", Sports: "⚽" }[cat] || "📦");

  const submit = () => {
    if (!draft.name.trim()) return;
    onAdd({ ...draft, price: parseFloat(draft.price) || 0, image: categoryEmoji(draft.category), id: Date.now() });
    setDraft({ name: "", brand: "", price: "", category: "Other" });
    setOpen(false);
  };

  if (!open) return (
    <button onClick={() => setOpen(true)} style={{ width: "100%", padding: "10px", borderRadius: 10, border: "1.5px dashed #C8B898", background: "transparent", color: "#8C7A5E", fontSize: 13, cursor: "pointer", fontFamily: "inherit", marginBottom: 12 }}>
      + Add item manually
    </button>
  );

  return (
    <div style={{ background: "#FAF7F2", border: "1.5px dashed #C8B898", borderRadius: 10, padding: "12px 14px", marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#6A5A4A", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>New item</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
          placeholder="Item name *"
          style={{ padding: "7px 10px", borderRadius: 7, border: "1px solid #C8B898", fontSize: 13, fontFamily: "inherit", background: "#FDFBF7", color: "#2C2416", outline: "none" }} />
        <div style={{ display: "flex", gap: 8 }}>
          <input value={draft.brand} onChange={e => setDraft(d => ({ ...d, brand: e.target.value }))}
            placeholder="Brand (optional)"
            style={{ flex: 1, padding: "7px 10px", borderRadius: 7, border: "1px solid #C8B898", fontSize: 13, fontFamily: "inherit", background: "#FDFBF7", color: "#2C2416", outline: "none" }} />
          <input value={draft.price} onChange={e => setDraft(d => ({ ...d, price: e.target.value }))}
            placeholder="$0.00" type="number" min="0" step="0.01"
            style={{ width: 80, padding: "7px 10px", borderRadius: 7, border: "1px solid #C8B898", fontSize: 13, fontFamily: "monospace", background: "#FDFBF7", color: "#2C2416", outline: "none" }} />
        </div>
        <select value={draft.category} onChange={e => setDraft(d => ({ ...d, category: e.target.value }))}
          style={{ padding: "7px 10px", borderRadius: 7, border: "1px solid #C8B898", fontSize: 13, fontFamily: "inherit", background: "#FDFBF7", color: "#2C2416", outline: "none" }}>
          {CATEGORIES.map(c => <option key={c} value={c}>{categoryEmoji(c)} {c}</option>)}
        </select>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={submit} style={{ flex: 1, padding: "8px", borderRadius: 7, border: "none", background: "#3A5A30", color: "#EAF3E8", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Add to cart</button>
          <button onClick={() => setOpen(false)} style={{ padding: "8px 14px", borderRadius: 7, border: "1px solid #C8B898", background: "transparent", color: "#6A5A4A", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function StoreCard({ store, items, index, expanded, onToggle }) {
  const matchedItems = items.filter(i => store.matches.includes(i.id));
  const altItems = items.filter(i => store.alternatives[i.id]);

  return (
    <div style={{ background: expanded ? "#FDFBF7" : "#FDFBF7", border: `1.5px solid ${expanded ? "#8CC878" : "#E2D8C8"}`, borderRadius: 14, marginBottom: 10, overflow: "hidden", transition: "border-color 0.2s" }}>
      <div onClick={onToggle} style={{ cursor: "pointer", padding: "12px 14px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          {/* Number badge */}
          <div style={{ width: 26, height: 26, borderRadius: 13, background: store.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, color: "white", flexShrink: 0, marginTop: 2 }}>
            {index + 1}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: 15, color: "#1E1810" }}>{store.name}</span>
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.04em", padding: "1px 6px", borderRadius: 20, background: store.color + "18", color: store.color, flexShrink: 0 }}>{storeTypeLabel[store.type]}</span>
            </div>
            <div style={{ fontSize: 12, color: "#8C7A5E", marginTop: 2 }}>
              📍 {store.distance} mi{store.rating ? ` · ⭐ ${store.rating}` : ""}
            </div>
            {(matchedItems.length > 0 || altItems.length > 0) && (
              <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
                {matchedItems.slice(0, 3).map(item => (
                  <span key={item.id} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 5, background: "#EAF3E8", color: "#3A6B45", border: "1px solid #C5DFC2" }}>{item.image} {item.name.split(" ").slice(0, 2).join(" ")}</span>
                ))}
                {altItems.slice(0, 2).map(item => (
                  <span key={item.id} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 5, background: "#FDF3E7", color: "#7A5A20", border: "1px solid #E8D4A8" }}>≈ {item.name.split(" ").slice(0, 2).join(" ")}</span>
                ))}
              </div>
            )}
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            {store.savings !== 0 && (
              <div style={{ fontSize: 12, fontWeight: 600, color: store.savings > 0 ? "#3A6B45" : "#6B3A3A" }}>
                {store.savings > 0 ? `~$${store.savings.toFixed(0)} less` : `~$${Math.abs(store.savings).toFixed(0)} more`}
              </div>
            )}
            <div style={{ fontSize: 10, color: "#A09080", marginTop: 1 }}>{matchedItems.length + altItems.length}/{items.length} items</div>
            <div style={{ fontSize: 16, color: "#C0B098", marginTop: 2 }}>{expanded ? "▲" : "▼"}</div>
          </div>
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: "1px solid #E8E0D0", padding: "12px 14px", background: "#FAF7F2" }}>
          {store.hours && <div style={{ fontSize: 12, color: "#8C7A5E", marginBottom: 6 }}>🕐 {store.hours}</div>}
          <div style={{ fontSize: 12, color: "#6A5A4A", marginBottom: 12 }}>📍 {store.address}</div>

          {matchedItems.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#3A6B45", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.04em" }}>Likely carries</div>
              {matchedItems.map(item => (
                <div key={item.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", borderBottom: "1px solid #EDE8DE" }}>
                  <span style={{ color: "#3A3020" }}>{item.image} {item.name}</span>
                  <span style={{ fontFamily: "monospace", color: "#4A3728" }}>${item.price.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}

          {altItems.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#7A5A20", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.04em" }}>Similar alternatives</div>
              {altItems.map(item => (
                <div key={item.id} style={{ fontSize: 13, padding: "4px 0", borderBottom: "1px solid #EDE8DE", color: "#5A4A30" }}>
                  {item.image} {store.alternatives[item.id]}
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button style={{ flex: 1, padding: "9px", borderRadius: 8, border: "none", background: "#3A5A30", color: "#EAF3E8", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              Reserve for Pickup →
            </button>
            <a href={store.mapsUrl} target="_blank" rel="noreferrer" style={{ padding: "9px 12px", borderRadius: 8, border: "1.5px solid #C8B898", background: "transparent", color: "#6A5A4A", fontSize: 13, cursor: "pointer", fontFamily: "inherit", textDecoration: "none", display: "flex", alignItems: "center" }}>
              Directions
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function MapView({ userLocation, stores, selectedId, onSelectStore }) {
  const mapRef = useRef(null);
  const googleMapRef = useRef(null);
  const markersRef = useRef([]);
  const userMarkerRef = useRef(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Load Google Maps JS API
  useEffect(() => {
    if (window.google?.maps) { setMapLoaded(true); return; }
    const existing = document.getElementById("gm-script");
    if (existing) {
      existing.addEventListener("load", () => setMapLoaded(true));
      return;
    }
    const script = document.createElement("script");
    script.id = "gm-script";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_API_KEY}`;
    script.async = true;
    script.onload = () => setMapLoaded(true);
    document.head.appendChild(script);
  }, []);

  // Init map once loaded + location available
  useEffect(() => {
    if (!mapLoaded || !userLocation || !mapRef.current) return;
    if (googleMapRef.current) return;

    const map = new window.google.maps.Map(mapRef.current, {
      center: { lat: userLocation.lat, lng: userLocation.lng },
      zoom: 13,
      disableDefaultUI: true,
      zoomControl: true,
      styles: [
        { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
        { featureType: "transit", stylers: [{ visibility: "off" }] },
        { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#f5f0e8" }] },
        { featureType: "road", elementType: "geometry", stylers: [{ color: "#e8e0d0" }] },
        { featureType: "water", elementType: "geometry", stylers: [{ color: "#c8dce8" }] },
      ],
    });
    googleMapRef.current = map;

    // User pin
    userMarkerRef.current = new window.google.maps.Marker({
      position: { lat: userLocation.lat, lng: userLocation.lng },
      map,
      title: "Your location",
      icon: {
        path: window.google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: "#3A5A30",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 2,
      },
      zIndex: 100,
    });
  }, [mapLoaded, userLocation]);

  // Update store markers whenever stores/selected changes
  useEffect(() => {
    if (!googleMapRef.current || !stores.length) return;
    const map = googleMapRef.current;

    // Clear old markers
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];

    stores.forEach((store, i) => {
      const isSelected = store.id === selectedId;
      const marker = new window.google.maps.Marker({
        position: { lat: store.lat, lng: store.lng },
        map,
        title: store.name,
        label: {
          text: String(i + 1),
          color: "white",
          fontSize: "11px",
          fontWeight: "bold",
        },
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: isSelected ? 18 : 13,
          fillColor: isSelected ? "#E8600A" : store.color,
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: isSelected ? 3 : 2,
        },
        zIndex: isSelected ? 50 : 10,
      });
      marker.addListener("click", () => onSelectStore(store.id));
      markersRef.current.push(marker);
    });

    // Fit bounds to include all stores + user
    if (userLocation) {
      const bounds = new window.google.maps.LatLngBounds();
      bounds.extend({ lat: userLocation.lat, lng: userLocation.lng });
      stores.forEach(s => bounds.extend({ lat: s.lat, lng: s.lng }));
      map.fitBounds(bounds, { top: 40, right: 20, bottom: 20, left: 20 });
    }
  }, [stores, selectedId, userLocation]);

  // Pan to selected store
  useEffect(() => {
    if (!googleMapRef.current || !selectedId) return;
    const store = stores.find(s => s.id === selectedId);
    if (store) googleMapRef.current.panTo({ lat: store.lat, lng: store.lng });
  }, [selectedId]);

  if (!mapLoaded || !userLocation) {
    return (
      <div style={{ height: 260, borderRadius: 14, background: "#EDE8DE", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
        <div style={{ textAlign: "center", color: "#8C7A5E" }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>🗺️</div>
          <div style={{ fontSize: 13 }}>Loading map…</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ borderRadius: 14, overflow: "hidden", marginBottom: 16, border: "1.5px solid #E2D8C8" }}>
      <div ref={mapRef} style={{ height: 280, width: "100%" }} />
      <div style={{ padding: "8px 12px", background: "#FAF7F2", display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <div style={{ width: 10, height: 10, borderRadius: 5, background: "#3A5A30" }} />
          <span style={{ fontSize: 11, color: "#6A5A4A" }}>You</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <div style={{ width: 10, height: 10, borderRadius: 5, background: "#5C4A2A" }} />
          <span style={{ fontSize: 11, color: "#6A5A4A" }}>Local shop</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <div style={{ width: 10, height: 10, borderRadius: 5, background: "#2C4A3E" }} />
          <span style={{ fontSize: 11, color: "#6A5A4A" }}>Chain</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <div style={{ width: 10, height: 10, borderRadius: 5, background: "#E8600A" }} />
          <span style={{ fontSize: 11, color: "#6A5A4A" }}>Selected</span>
        </div>
      </div>
    </div>
  );
}

function LoadingState({ stage }) {
  const stages = [
    { key: "location", label: "Getting your location…", icon: "📍" },
    { key: "places", label: "Searching nearby stores…", icon: "🗺️" },
    { key: "matching", label: "Matching items with Claude…", icon: "🤖" },
  ];
  const current = stages.findIndex(s => s.key === stage);
  return (
    <div style={{ padding: "40px 20px", textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>{stages[current]?.icon || "🌿"}</div>
      <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 20, color: "#2C2416", marginBottom: 8 }}>{stages[current]?.label}</div>
      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 20 }}>
        {stages.map((s, i) => (
          <div key={s.key} style={{ width: 8, height: 8, borderRadius: 4, background: i <= current ? "#3A5A30" : "#D8CEB8", transition: "background 0.3s" }} />
        ))}
      </div>
      <div style={{ marginTop: 16, fontSize: 13, color: "#8C7A5E" }}>
        {current === 2 ? "Reasoning about which stores carry your items…" : "This takes just a moment"}
      </div>
    </div>
  );
}

export default function App() {
  const [step, setStep] = useState("import");
  const [items, setItems] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [previewImg, setPreviewImg] = useState(null);
  const [parseError, setParseError] = useState(null);
  const [expandedStore, setExpandedStore] = useState(null);
  const [stores, setStores] = useState([]);
  const [loadingStage, setLoadingStage] = useState(null);
  const [locationError, setLocationError] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [viewMode, setViewMode] = useState("map");
  const [locationInput, setLocationInput] = useState("");
  const [locationLabel, setLocationLabel] = useState(null);
  const [geocodeError, setGeocodeError] = useState(null);
  const [showManualLocation, setShowManualLocation] = useState(false);
  const fileRef = useRef();
  const listRef = useRef();

  const [prefs, setPrefs] = useState({
    storeTypes: { "mom-and-pop": true, chain: true, "big-box": false },
    maxDistance: 5,
    prioritize: "local",
    showAlternatives: true,
  });

  const handleImage = async (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target.result.split(",")[1];
      setPreviewImg(e.target.result);
      setIsAnalyzing(true);
      setParseError(null);
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": "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",
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1000,
            messages: [{ role: "user", content: [
              { type: "image", source: { type: "base64", media_type: file.type, data: base64 } },
              { type: "text", text: `Extract all shopping cart items from this screenshot. Return ONLY a JSON array like:\n[{"name":"Product Name","brand":"Brand","price":29.99,"category":"Kitchen"}]\nCategories: Kitchen, Home, Clothing, Electronics, Garden, Food, Beauty, Sports, Other.\nIf no brand visible use "Unknown". Return only valid JSON, no other text.` }
            ]}]
          })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error?.message || `API error ${res.status}`);
        }
        const data = await res.json();
        const text = data.content.find(b => b.type === "text")?.text || "[]";
        const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
        if (!parsed.length) throw new Error("No items found in screenshot. Try a clearer image.");
        setItems(parsed.map((item, i) => ({ ...item, id: i + 1, image: categoryEmoji(item.category) })));
        setPreviewImg(e.target.result);
      } catch (err) {
        setPreviewImg(null);
        setParseError(err.message || "Couldn't read the screenshot. Please try again.");
      }
      finally { setIsAnalyzing(false); }
    };
    reader.readAsDataURL(file);
  };

  const categoryEmoji = (cat) => ({ Kitchen: "🍳", Home: "🏠", Clothing: "👕", Electronics: "💻", Garden: "🌱", Food: "🥘", Beauty: "✨", Sports: "⚽" }[cat] || "📦");

  const [debugMsg, setDebugMsg] = useState(null);

  const runSearch = useCallback(async (lat, lng) => {
    setLoadingStage("places");
    setDebugMsg(null);
    try {
      const rawStores = await fetchNearbyStores(lat, lng, items, prefs.maxDistance);
      setDebugMsg(`Places returned ${rawStores.length} stores. First: ${rawStores[0]?.name || "none"}. IDs start with: ${rawStores[0]?.id?.slice(0,8) || "n/a"}`);
      setLoadingStage("matching");
      const matched = await matchItemsToStores(rawStores, items);
      setStores(matched);
    } catch (err) {
      setDebugMsg(`Error: ${err.message}`);
    }
    setLoadingStage(null);
  }, [items, prefs.maxDistance]);

  const findStores = useCallback(async () => {
    setStores([]);
    setLocationError(null);
    setGeocodeError(null);
    setExpandedStore(null);
    setLoadingStage("location");
    try {
      const pos = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 })
      );
      const { latitude: lat, longitude: lng } = pos.coords;
      setUserLocation({ lat, lng });
      setLocationLabel(null);
      setShowManualLocation(false);
      await runSearch(lat, lng);
    } catch (err) {
      setLoadingStage(null);
      setShowManualLocation(true);
      setLocationError("Automatic location unavailable. Enter your city or zip below.");
    }
  }, [runSearch]);

  const findStoresByInput = useCallback(async () => {
    if (!locationInput.trim()) return;
    setGeocodeError(null);
    setStores([]);
    setExpandedStore(null);
    setLoadingStage("location");
    try {
      const { lat, lng, label } = await geocodeLocation(locationInput.trim());
      setUserLocation({ lat, lng });
      setLocationLabel(label);
      setShowManualLocation(false);
      setLocationError(null);
      await runSearch(lat, lng);
    } catch {
      setLoadingStage(null);
      setGeocodeError("Couldn't find that location. Try a city name or zip code.");
    }
  }, [locationInput, runSearch]);

  const goToResults = () => { setStep("results"); findStores(); };

  const handleSelectStore = (id) => {
    setExpandedStore(id === expandedStore ? null : id);
    // Switch to list view and scroll to card when pin tapped on map
    setViewMode("list");
    setTimeout(() => {
      const el = document.getElementById(`store-card-${id}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  };

  const filteredStores = stores.filter(s => prefs.storeTypes[s.type]).sort((a, b) => {
    if (prefs.prioritize === "local") {
      const score = s => s.type === "mom-and-pop" ? 0 : s.type === "chain" ? 1 : 2;
      return score(a) - score(b) || a.distance - b.distance;
    }
    if (prefs.prioritize === "price") return b.savings - a.savings;
    return a.distance - b.distance;
  });

  const cartTotal = items.reduce((s, i) => s + i.price, 0);

  return (
    <div style={{ minHeight: "100vh", background: "#F5F0E8", fontFamily: "'DM Sans', system-ui, sans-serif", maxWidth: 480, margin: "0 auto" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ background: "#2C2416", padding: "20px 20px 16px", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }}>🌿</span>
          <div>
            <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 20, color: "#EDE8DC", letterSpacing: "-0.02em" }}>NearBuy</div>
            <div style={{ fontSize: 11, color: "#8C7A5E", marginTop: 1, letterSpacing: "0.06em", textTransform: "uppercase" }}>Your cart. Bought local.</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
          {STEPS.map((s, i) => (
            <div key={s} style={{ flex: 1, height: 3, borderRadius: 2, background: STEPS.indexOf(step) >= i ? "#8CC878" : "#4A3E2C", transition: "background 0.3s" }} />
          ))}
        </div>
      </div>

      <div style={{ padding: "20px 16px 40px" }}>

        {/* STEP 1: IMPORT */}
        {step === "import" && (
          <div>
            <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 26, color: "#1E1810", margin: "0 0 6px", lineHeight: 1.2 }}>What's in your cart?</h2>
            <p style={{ fontSize: 14, color: "#7A6A52", margin: "0 0 20px", lineHeight: 1.6 }}>Add items from your Amazon, Walmart, or Target cart and we'll find them at local stores nearby.</p>

            {/* Items list — always shown */}
            {items.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 18, color: "#2C2416" }}>Your cart ({items.length} item{items.length !== 1 ? "s" : ""})</div>
                  <div style={{ fontFamily: "monospace", fontSize: 14, color: "#4A3728" }}>${cartTotal.toFixed(2)}</div>
                </div>
                {items.map(item => (
                  <CartItem key={item.id} item={item}
                    onRemove={id => setItems(items.filter(i => i.id !== id))}
                    onUpdate={updated => setItems(items.map(i => i.id === updated.id ? updated : i))} />
                ))}
              </div>
            )}

            {/* Add item — always visible */}
            <AddItemRow onAdd={newItem => setItems(prev => [...prev, newItem])} />

            {/* Screenshot upload — collapsed by default */}
            <details style={{ marginBottom: 16 }}>
              <summary style={{ fontSize: 13, color: "#8C7A5E", cursor: "pointer", padding: "8px 0", listStyle: "none", display: "flex", alignItems: "center", gap: 6 }}>
                <span>📸</span>
                <span>Or import from a cart screenshot</span>
                <span style={{ marginLeft: "auto", fontSize: 11 }}>▼</span>
              </summary>
              <div style={{ marginTop: 10 }}>
                <div
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => { e.preventDefault(); setDragOver(false); handleImage(e.dataTransfer.files[0]); }}
                  onClick={() => fileRef.current.click()}
                  style={{ border: `2px dashed ${dragOver ? "#6B9E5E" : "#C8B898"}`, borderRadius: 16, padding: "24px 20px", textAlign: "center", cursor: "pointer", background: dragOver ? "#F0F8EC" : "#FAF7F2", transition: "all 0.2s" }}>
                  <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => handleImage(e.target.files[0])} />
                  {isAnalyzing ? (
                    <div><div style={{ fontSize: 28, marginBottom: 8 }}>🔍</div><div style={{ fontSize: 14, color: "#2C2416" }}>Scanning your cart...</div></div>
                  ) : previewImg ? (
                    <div><img src={previewImg} alt="Cart screenshot" style={{ maxWidth: "100%", maxHeight: 140, borderRadius: 8, marginBottom: 8 }} /><div style={{ fontSize: 13, color: "#6B9E5E" }}>✓ Screenshot uploaded</div></div>
                  ) : (
                    <div><div style={{ fontSize: 32, marginBottom: 8 }}>📸</div><div style={{ fontSize: 14, color: "#2C2416", marginBottom: 3 }}>Drop a cart screenshot</div><div style={{ fontSize: 12, color: "#8C7A5E" }}>Works with Amazon, Walmart & Target</div></div>
                  )}
                </div>
                {parseError && (
                  <div style={{ padding: "10px 14px", background: "#FAF0EE", border: "1px solid #E8C8C0", borderRadius: 10, marginTop: 10, fontSize: 13, color: "#8B3A2A", lineHeight: 1.5 }}>
                    ⚠ {parseError}
                  </div>
                )}
              </div>
            </details>

            {items.length > 0 && (
              <button onClick={() => setStep("preferences")} style={{ width: "100%", padding: "14px", borderRadius: 12, border: "none", background: "#3A5A30", color: "#EAF3E8", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Serif Display', serif" }}>
                Set my preferences →
              </button>
            )}
          </div>
        )}

        {/* STEP 2: PREFERENCES */}
        {step === "preferences" && (
          <div>
            <button onClick={() => setStep("import")} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#8C7A5E", padding: 0, marginBottom: 16, fontFamily: "inherit" }}>← Back</button>
            <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 26, color: "#1E1810", margin: "0 0 6px" }}>Your shopping values</h2>
            <p style={{ fontSize: 14, color: "#7A6A52", margin: "0 0 24px", lineHeight: 1.6 }}>Customize how we find local alternatives for you.</p>

            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#4A3728", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 10 }}>Store types</div>
              {[
                { key: "mom-and-pop", label: "🏪 Mom & Pop Shops", desc: "Independent, locally-owned" },
                { key: "chain", label: "🏬 Regional Chains", desc: "Local chains & co-ops" },
                { key: "big-box", label: "🏢 Big Box Stores", desc: "Target, Walmart, etc." },
              ].map(({ key, label, desc }) => (
                <div key={key} onClick={() => setPrefs(p => ({ ...p, storeTypes: { ...p.storeTypes, [key]: !p.storeTypes[key] } }))}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 10, marginBottom: 8, border: `1.5px solid ${prefs.storeTypes[key] ? "#8CC878" : "#D8CEB8"}`, background: prefs.storeTypes[key] ? "#F0F8EC" : "#FAF7F2", cursor: "pointer", transition: "all 0.15s" }}>
                  <div style={{ width: 20, height: 20, borderRadius: 4, border: `2px solid ${prefs.storeTypes[key] ? "#3A6B45" : "#C0B09A"}`, background: prefs.storeTypes[key] ? "#3A6B45" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {prefs.storeTypes[key] && <span style={{ fontSize: 12, color: "white" }}>✓</span>}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, color: "#2C2416" }}>{label}</div>
                    <div style={{ fontSize: 12, color: "#8C7A5E" }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#4A3728", letterSpacing: "0.05em", textTransform: "uppercase" }}>Max distance</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#3A5A30" }}>{prefs.maxDistance} miles</div>
              </div>
              <input type="range" min={1} max={25} step={1} value={prefs.maxDistance} onChange={e => setPrefs(p => ({ ...p, maxDistance: +e.target.value }))} style={{ width: "100%", accentColor: "#3A5A30" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#A09080", marginTop: 4 }}>
                <span>1 mile</span><span>Walking</span><span>25 miles</span>
              </div>
            </div>

            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#4A3728", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 10 }}>Sort results by</div>
              {[
                { key: "local", label: "🏪 Most local first", desc: "Prioritize independent shops" },
                { key: "price", label: "💰 Best savings first", desc: "Maximize price comparison" },
                { key: "distance", label: "📍 Closest first", desc: "Minimize your drive" },
              ].map(({ key, label, desc }) => (
                <div key={key} onClick={() => setPrefs(p => ({ ...p, prioritize: key }))}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 10, marginBottom: 8, border: `1.5px solid ${prefs.prioritize === key ? "#8CC878" : "#D8CEB8"}`, background: prefs.prioritize === key ? "#F0F8EC" : "#FAF7F2", cursor: "pointer", transition: "all 0.15s" }}>
                  <div style={{ width: 18, height: 18, borderRadius: 9, border: `2px solid ${prefs.prioritize === key ? "#3A6B45" : "#C0B09A"}`, background: prefs.prioritize === key ? "#3A6B45" : "transparent", flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 14, color: "#2C2416" }}>{label}</div>
                    <div style={{ fontSize: 12, color: "#8C7A5E" }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>

            <div onClick={() => setPrefs(p => ({ ...p, showAlternatives: !p.showAlternatives }))}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 10, marginBottom: 24, border: `1.5px solid ${prefs.showAlternatives ? "#8CC878" : "#D8CEB8"}`, background: prefs.showAlternatives ? "#F0F8EC" : "#FAF7F2", cursor: "pointer" }}>
              <div style={{ width: 20, height: 20, borderRadius: 4, border: `2px solid ${prefs.showAlternatives ? "#3A6B45" : "#C0B09A"}`, background: prefs.showAlternatives ? "#3A6B45" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {prefs.showAlternatives && <span style={{ fontSize: 12, color: "white" }}>✓</span>}
              </div>
              <div>
                <div style={{ fontSize: 14, color: "#2C2416" }}>🔄 Show similar alternatives</div>
                <div style={{ fontSize: 12, color: "#8C7A5E" }}>Suggest local substitutes when exact match unavailable</div>
              </div>
            </div>

            <button onClick={goToResults} style={{ width: "100%", padding: "14px", borderRadius: 12, border: "none", background: "#3A5A30", color: "#EAF3E8", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Serif Display', serif" }}>
              Find local stores →
            </button>
          </div>
        )}

        {/* STEP 3: RESULTS */}
        {step === "results" && (
          <div>
            <button onClick={() => setStep("preferences")} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#8C7A5E", padding: 0, marginBottom: 16, fontFamily: "inherit" }}>← Preferences</button>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 26, color: "#1E1810", margin: "0 0 4px" }}>Found nearby</h2>
                {!loadingStage && !locationError && !showManualLocation && (
                  <p style={{ fontSize: 13, color: "#7A6A52", margin: 0 }}>
                    {filteredStores.length} store{filteredStores.length !== 1 ? "s" : ""} within {prefs.maxDistance} mi
                    {locationLabel && <span style={{ color: "#A09080" }}> · {locationLabel}</span>}
                  </p>
                )}
              </div>
              {/* Map / List toggle */}
              {!loadingStage && !locationError && !showManualLocation && filteredStores.length > 0 && (
                <div style={{ display: "flex", background: "#EDE8DE", borderRadius: 8, padding: 3, gap: 2 }}>
                  {["map", "list"].map(mode => (
                    <button key={mode} onClick={() => setViewMode(mode)} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: viewMode === mode ? "#2C2416" : "transparent", color: viewMode === mode ? "#EDE8DC" : "#6A5A4A", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s" }}>
                      {mode === "map" ? "🗺 Map" : "☰ List"}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {loadingStage ? (
              <LoadingState stage={loadingStage} />
            ) : showManualLocation ? (
              <div>
                <div style={{ textAlign: "center", marginBottom: 20 }}>
                  <div style={{ fontSize: 36, marginBottom: 10 }}>📍</div>
                  <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 20, color: "#2C2416", marginBottom: 6 }}>Where are you shopping?</div>
                  <div style={{ fontSize: 13, color: "#8C7A5E", lineHeight: 1.6 }}>{locationError}</div>
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <input
                    type="text"
                    placeholder="City, state or zip code…"
                    value={locationInput}
                    onChange={e => setLocationInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && findStoresByInput()}
                    style={{ flex: 1, padding: "12px 14px", borderRadius: 10, border: "1.5px solid #C8B898", background: "#FAF7F2", fontSize: 14, fontFamily: "inherit", color: "#2C2416", outline: "none" }}
                  />
                  <button onClick={findStoresByInput} style={{ padding: "12px 16px", borderRadius: 10, border: "none", background: "#3A5A30", color: "#EAF3E8", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                    Search →
                  </button>
                </div>
                {geocodeError && <div style={{ fontSize: 13, color: "#8B3A2A", marginBottom: 12, padding: "8px 12px", background: "#FAF0EE", borderRadius: 8, lineHeight: 1.5 }}>⚠ {geocodeError}</div>}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
                  {["Denver, CO", "Brooklyn, NY", "Austin, TX", "Portland, OR"].map(city => (
                    <button key={city} onClick={() => { setLocationInput(city); }} style={{ padding: "6px 12px", borderRadius: 20, border: "1px solid #C8B898", background: "transparent", color: "#6A5A4A", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>{city}</button>
                  ))}
                </div>
                <button onClick={findStores} style={{ width: "100%", padding: "11px", borderRadius: 10, border: "1.5px solid #C8B898", background: "transparent", color: "#6A5A4A", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
                  🔄 Try automatic location again
                </button>
              </div>
            ) : (
              <>
                {debugMsg && (
                  <div style={{ padding: "10px 14px", background: "#2C2416", borderRadius: 10, marginBottom: 12, fontSize: 12, color: "#8CC878", fontFamily: "monospace", lineHeight: 1.5 }}>
                    🔍 {debugMsg}
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", background: "#2C2416", borderRadius: 10, padding: "10px 14px", marginBottom: 16 }}>
                  <div style={{ fontSize: 13, color: "#8C7A5E" }}>Your online cart total</div>
                  <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 600, color: "#EDE8DC" }}>${cartTotal.toFixed(2)}</div>
                </div>

                {/* MAP VIEW */}
                {viewMode === "map" && userLocation && (
                  <>
                    <MapView
                      userLocation={userLocation}
                      stores={filteredStores}
                      selectedId={expandedStore}
                      onSelectStore={handleSelectStore}
                    />
                    {/* Mini cards below map */}
                    <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 8, marginBottom: 4 }}>
                      {filteredStores.map((store, i) => (
                        <div key={store.id} onClick={() => { setExpandedStore(store.id === expandedStore ? null : store.id); }}
                          style={{ flexShrink: 0, width: 160, padding: "10px 12px", borderRadius: 10, border: `1.5px solid ${expandedStore === store.id ? "#8CC878" : "#E2D8C8"}`, background: expandedStore === store.id ? "#F0F8EC" : "#FDFBF7", cursor: "pointer" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                            <div style={{ width: 20, height: 20, borderRadius: 10, background: store.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "white", flexShrink: 0 }}>{i + 1}</div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "#2C2416", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{store.name}</div>
                          </div>
                          <div style={{ fontSize: 11, color: "#8C7A5E" }}>{store.distance} mi · {store.matches.length + Object.keys(store.alternatives).length}/{items.length} items</div>
                        </div>
                      ))}
                    </div>
                    {/* Expanded card below strip */}
                    {expandedStore && (() => {
                      const store = filteredStores.find(s => s.id === expandedStore);
                      const idx = filteredStores.findIndex(s => s.id === expandedStore);
                      return store ? <div style={{ marginTop: 10 }}><StoreCard store={store} items={items} index={idx} expanded={true} onToggle={() => setExpandedStore(null)} /></div> : null;
                    })()}
                  </>
                )}

                {/* LIST VIEW */}
                {viewMode === "list" && (
                  <div ref={listRef}>
                    {filteredStores.length === 0 ? (
                      <div style={{ textAlign: "center", padding: "40px 20px" }}>
                        <div style={{ fontSize: 40, marginBottom: 12 }}>🗺️</div>
                        <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 18, color: "#2C2416", marginBottom: 8 }}>No stores match your filters</div>
                        <div style={{ fontSize: 14, color: "#8C7A5E" }}>Try increasing distance or enabling more store types.</div>
                        <button onClick={() => setStep("preferences")} style={{ marginTop: 16, padding: "10px 20px", borderRadius: 8, border: "1.5px solid #C8B898", background: "transparent", color: "#6A5A4A", fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>Adjust preferences</button>
                      </div>
                    ) : (
                      filteredStores.map((store, i) => (
                        <div key={store.id} id={`store-card-${store.id}`}>
                          <StoreCard store={store} items={items} index={i}
                            expanded={expandedStore === store.id}
                            onToggle={() => setExpandedStore(expandedStore === store.id ? null : store.id)} />
                        </div>
                      ))
                    )}
                  </div>
                )}

                {filteredStores.length > 0 && (
                  <ImpactCard
                    items={items}
                    bestStore={filteredStores[0]}
                    cityName={locationLabel}
                  />
                )}

                <button onClick={findStores} style={{ width: "100%", marginTop: 12, padding: "11px", borderRadius: 10, border: "1.5px solid #C8B898", background: "transparent", color: "#6A5A4A", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
                  🔄 Refresh results
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
