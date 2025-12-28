import type { Product, ProductLookupResponse, ProductSearchResponse, StoreSearchResponse } from "@pricecart/shared";
import "leaflet/dist/leaflet.css";
import { useMemo, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import { fetchStores, lookupProductByUpc, searchProducts } from "./lib/api";

function formatErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export default function App() {
  const [view, setView] = useState<"stores" | "products">("stores");

  // Phase 1: Stores
  const [location, setLocation] = useState("10001");
  const [radius, setRadius] = useState(1500);
  const [storesData, setStoresData] = useState<StoreSearchResponse | null>(null);
  const [status, setStatus] = useState<string>("");

  const center = useMemo(() => {
    if (!storesData) return { lat: 40.7484, lon: -73.9857 };
    return storesData.center;
  }, [storesData]);

  async function onStoreSearch() {
    setStatus("Searching...");
    try {
      const res = await fetchStores({ location, radius_m: radius });
      setStoresData(res);
      setStatus(res.data_mode === "live" ? "" : `Using ${res.data_mode} data`);
    } catch (e: unknown) {
      setStatus(`Error: ${formatErrorMessage(e)}`);
    }
  }

  // Phase 2: Products
  const [upc, setUpc] = useState("");
  const [lookup, setLookup] = useState<ProductLookupResponse | null>(null);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState<ProductSearchResponse | null>(null);
  const [pStatus, setPStatus] = useState<string>("");

  type CartItem = { upc: string; name: string; brand: string | null; quantityLabel: string; count: number };
  const [cart, setCart] = useState<CartItem[]>([]);

  function addToCart(p: Product) {
    const label = p.quantity?.raw || (p.quantity?.value && p.quantity?.unit ? `${p.quantity.value} ${p.quantity.unit}` : "");

    setCart((prev) => {
      const ix = prev.findIndex((x) => x.upc === p.upc);
      if (ix >= 0) {
        const copy = [...prev];
        copy[ix] = { ...copy[ix], count: copy[ix].count + 1 };
        return copy;
      }
      return [...prev, { upc: p.upc, name: p.name, brand: p.brand ?? null, quantityLabel: label, count: 1 }];
    });
  }

  function removeFromCart(upc: string) {
    setCart((prev) => prev.filter((x) => x.upc !== upc));
  }

  async function onLookup() {
    setPStatus("Looking up...");
    setLookup(null);
    try {
      const res = await lookupProductByUpc(upc);
      setLookup(res);
      setPStatus(res.data_mode === "live" ? "" : `Using ${res.data_mode}${res.cache_state ? ` (${res.cache_state})` : ""}`);
    } catch (e: unknown) {
      setPStatus(`Error: ${formatErrorMessage(e)}`);
    }
  }

  async function onSearchProducts() {
    setPStatus("Searching products...");
    setSearch(null);
    try {
      const res = await searchProducts({ q, page: 1, page_size: 10 });
      setSearch(res);
      setPStatus(res.data_mode === "live" ? "" : `Using ${res.data_mode}${res.cache_state ? ` (${res.cache_state})` : ""}`);
    } catch (e: unknown) {
      setPStatus(`Error: ${formatErrorMessage(e)}`);
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "420px 1fr", height: "100vh" }}>
      <div style={{ padding: 16, overflow: "auto", borderRight: "1px solid #eee" }}>
        <h1 style={{ marginTop: 0 }}>PriceCart</h1>
        <p style={{ marginTop: 0, opacity: 0.8 }}>Phase 1: Stores • Phase 2: Product identity</p>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button onClick={() => setView("stores")} style={{ padding: "8px 12px", opacity: view === "stores" ? 1 : 0.6 }}>
            Stores
          </button>
          <button onClick={() => setView("products")} style={{ padding: "8px 12px", opacity: view === "products" ? 1 : 0.6 }}>
            Products
          </button>
        </div>

        {view === "stores" ? (
          <>
            <h2 style={{ marginTop: 8 }}>Stores</h2>

            <label style={{ display: "block", fontWeight: 600 }}>ZIP / Address</label>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              style={{ width: "100%", padding: 8, margin: "8px 0" }}
              placeholder="10001"
            />

            <label style={{ display: "block", fontWeight: 600 }}>Radius (meters)</label>
            <input
              type="number"
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              style={{ width: "100%", padding: 8, margin: "8px 0" }}
              min={250}
              max={20000}
            />

            <button onClick={onStoreSearch} style={{ padding: "8px 12px" }}>
              Search stores
            </button>

            {status && <p style={{ marginTop: 12, padding: 10, background: "#f7f7f7" }}>{status}</p>}

            {storesData?.stores?.length ? (
              <>
                <h3>Results</h3>
                <ol>
                  {storesData.stores.map((s) => (
                    <li key={s.id}>
                      <div style={{ fontWeight: 600 }}>{s.name}</div>
                      <div style={{ opacity: 0.8 }}>{Math.round(s.distance_m)} m</div>
                    </li>
                  ))}
                </ol>

                {storesData.data_mode !== "live" ? (
                  <p style={{ fontSize: 12, opacity: 0.75 }}>
                    Live providers may be rate limited or temporarily unavailable. This view is still valid for demos.
                  </p>
                ) : null}

                <footer style={{ marginTop: 16, fontSize: 12, opacity: 0.8 }}>
                  <div>{storesData.attribution.text}</div>
                  <div>
                    {storesData.attribution.links.map((l) => (
                      <a key={l.href} href={l.href} target="_blank" rel="noreferrer" style={{ marginRight: 8 }}>
                        {l.label}
                      </a>
                    ))}
                  </div>
                </footer>
              </>
            ) : null}
          </>
        ) : (
          <>
            <h2 style={{ marginTop: 8 }}>Products</h2>

            <h3>UPC lookup</h3>
            <label style={{ display: "block", fontWeight: 600 }}>UPC (8–14 digits)</label>
            <input
              value={upc}
              onChange={(e) => setUpc(e.target.value)}
              style={{ width: "100%", padding: 8, margin: "8px 0" }}
              placeholder="0123456789012"
            />
            <button onClick={onLookup} style={{ padding: "8px 12px" }}>
              Lookup
            </button>

            <h3 style={{ marginTop: 16 }}>Text search</h3>
            <label style={{ display: "block", fontWeight: 600 }}>Search</label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ width: "100%", padding: 8, margin: "8px 0" }}
              placeholder="milk"
            />
            <button onClick={onSearchProducts} style={{ padding: "8px 12px" }}>
              Search
            </button>

            {pStatus && <p style={{ marginTop: 12, padding: 10, background: "#f7f7f7" }}>{pStatus}</p>}

            {lookup?.product ? (
              <>
                <h3 style={{ marginTop: 16 }}>Lookup result</h3>
                <div style={{ padding: 12, border: "1px solid #eee", borderRadius: 8 }}>
                  <div style={{ display: "flex", gap: 12 }}>
                    {lookup.product.image_url ? (
                      <img src={lookup.product.image_url} alt="" style={{ width: 72, height: 72, objectFit: "cover" }} />
                    ) : null}
                    <div>
                      <div style={{ fontWeight: 700 }}>{lookup.product.name}</div>
                      <div style={{ opacity: 0.8 }}>{lookup.product.brand ?? ""}</div>
                      <div style={{ fontSize: 12, opacity: 0.8 }}>UPC: {lookup.product.upc}</div>
                    </div>
                  </div>

                  <button onClick={() => addToCart(lookup.product)} style={{ marginTop: 12, padding: "8px 12px" }}>
                    Add to cart
                  </button>

                  <div style={{ marginTop: 12, fontSize: 12, opacity: 0.8 }}>
                    <div>{lookup.attribution.text}</div>
                    <div>
                      {lookup.attribution.links.map((l) => (
                        <a key={l.href} href={l.href} target="_blank" rel="noreferrer" style={{ marginRight: 8 }}>
                          {l.label}
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            ) : null}

            {search?.products?.length ? (
              <>
                <h3 style={{ marginTop: 16 }}>Search results</h3>
                <ul style={{ paddingLeft: 18 }}>
                  {search.products.map((p) => (
                    <li key={p.upc} style={{ marginBottom: 8 }}>
                      <div style={{ fontWeight: 600 }}>{p.name}</div>
                      <div style={{ fontSize: 12, opacity: 0.8 }}>{p.brand ?? ""} • {p.upc}</div>
                      <button onClick={() => addToCart(p)} style={{ marginTop: 6, padding: "6px 10px" }}>
                        Add
                      </button>
                    </li>
                  ))}
                </ul>

                <div style={{ marginTop: 12, fontSize: 12, opacity: 0.8 }}>
                  <div>{search.attribution.text}</div>
                  <div>
                    {search.attribution.links.map((l) => (
                      <a key={l.href} href={l.href} target="_blank" rel="noreferrer" style={{ marginRight: 8 }}>
                        {l.label}
                      </a>
                    ))}
                  </div>
                </div>
              </>
            ) : null}

            <h3 style={{ marginTop: 16 }}>Cart (local)</h3>
            {cart.length ? (
              <ul style={{ paddingLeft: 18 }}>
                {cart.map((x) => (
                  <li key={x.upc} style={{ marginBottom: 8 }}>
                    <div style={{ fontWeight: 600 }}>
                      {x.name} {x.count > 1 ? `×${x.count}` : ""}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>{x.brand ?? ""} • {x.upc} {x.quantityLabel ? `• ${x.quantityLabel}` : ""}</div>
                    <button onClick={() => removeFromCart(x.upc)} style={{ marginTop: 6, padding: "6px 10px" }}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ opacity: 0.8 }}>Cart is empty.</p>
            )}
          </>
        )}
      </div>

      <div style={{ height: "100%" }}>
        <MapContainer center={[center.lat, center.lon]} zoom={13} style={{ height: "100%", width: "100%" }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
          {storesData?.stores?.map((s) => (
            <Marker key={s.id} position={[s.lat, s.lon]}>
              <Popup>
                <strong>{s.name}</strong>
                <br />
                {Math.round(s.distance_m)} m
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}
