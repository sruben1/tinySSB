/*
    prod/map/map.js

    Core logic for the MapLibre map component.

    Tile strategy
    ─────────────
    On startup we ask Kotlin whether an MBTiles file is present at
    filesDir/map.mbtiles.  Kotlin responds via map_on_mbtiles_status().
    • If present  → tiles are served through the WebViewAssetLoader at
                    https://appassets.androidplatform.net/internal/map.mbtiles
                    via the mbtiles:// custom protocol handler below.
    • If absent   → fall back to OSM raster tiles (requires internet).

    Pin storage
    ───────────
    Pins live in a plain JS object (map_pins) keyed by a short random id.
    Each pin: { id, lon, lat, title, comment, ts }
    On every mutation we call Android.onFrontendRequest("map:pins:save <b64json>").
    Kotlin writes filesDir/map_pins.json.  On init we call map:pins:load and
    Kotlin calls back map_on_pins_loaded(b64json).

    JS → Kotlin calls (all via Android.onFrontendRequest):
        "map:pins:save <base64(JSON array)>"
        "map:pins:load"
        "map:mbtiles:check"

    Kotlin → JS callbacks:
        map_on_mbtiles_status(true|false)
        map_on_pins_loaded("<base64(JSON array)>")
*/

"use strict";

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */

var map_instance  = null;
var map_ready     = false;
var map_pins      = {};        // id → { id, lon, lat, title, comment, ts }
var _pin_markers  = {};        // id → maplibregl.Marker
var _geo_watch_id = null;
var _my_marker    = null;
var _use_mbtiles  = false;

var MAP_DEFAULT_CENTER = [8.5417, 47.3769];
var MAP_DEFAULT_ZOOM   = 12;

/* ------------------------------------------------------------------ */
/*  Tile styles                                                        */
/* ------------------------------------------------------------------ */

// Online OSM raster fallback (used when no local MBTiles present)
function _osm_style() {
    return {
        version: 8,
        sources: {
            osm: {
                type: "raster",
                tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
                tileSize: 256,
                attribution: "© OpenStreetMap contributors",
                maxzoom: 19
            }
        },
        layers: [{ id: "osm-bg", type: "raster", source: "osm" }]
    };
}

/*
 * Vector tile style from our locally-generated MBTiles.
 *
 * How the tiles reach the WebView
 * ────────────────────────────────
 * The MBTiles file at filesDir/map.mbtiles is a SQLite database.
 * We cannot serve it as a static file; instead MainActivity registers
 * a custom MbTilesPathHandler at /mbtiles/ that reads individual tiles
 * out of the SQLite DB and returns them as HTTP responses.  See the
 * Kotlin section in INTEGRATION.md for the handler code.
 *
 * The tile URL template below therefore hits that handler:
 *   https://appassets.androidplatform.net/mbtiles/{z}/{x}/{y}.pbf
 *
 * Layer names and their attributes must match process-minimal.lua exactly.
 */
function _vector_style() {
    var TILE_URL = "https://appassets.androidplatform.net/mbtiles/{z}/{x}/{y}.pbf";
    return {
        version: 8,
        sources: {
            openmaptiles: {
                type:    "vector",
                tiles:   [TILE_URL],
                minzoom: 4,
                maxzoom: 14
            }
        },
        layers: [
            // ── Background ───────────────────────────────────────────────
            {
                id:   "background",
                type: "background",
                paint: { "background-color": "#f8f4f0" }
            },

            // ── Water areas ──────────────────────────────────────────────
            {
                id:     "water-areas",
                type:   "fill",
                source: "openmaptiles",
                "source-layer": "water_areas",
                paint: {
                    "fill-color": "#a8d4e6",
                    "fill-outline-color": "#6badc8"
                }
            },

            // ── Vegetation ───────────────────────────────────────────────
            {
                id:     "vegetation-glacier",
                type:   "fill",
                source: "openmaptiles",
                "source-layer": "vegetation",
                filter: ["==", "class", "glacier"],
                paint: { "fill-color": "#e8f0f8", "fill-opacity": 0.9 }
            },
            {
                id:     "vegetation-forest",
                type:   "fill",
                source: "openmaptiles",
                "source-layer": "vegetation",
                filter: ["==", "class", "forest"],
                paint: { "fill-color": "#c8ddb0", "fill-opacity": 0.8 }
            },
            {
                id:     "vegetation-grass",
                type:   "fill",
                source: "openmaptiles",
                "source-layer": "vegetation",
                filter: ["in", "class", "grass", "scrub"],
                paint: { "fill-color": "#ddecc8", "fill-opacity": 0.7 }
            },
            {
                id:     "vegetation-rock",
                type:   "fill",
                source: "openmaptiles",
                "source-layer": "vegetation",
                filter: ["==", "class", "rock"],
                paint: { "fill-color": "#d8d0c8", "fill-opacity": 0.7 }
            },

            // ── Waterways ────────────────────────────────────────────────
            {
                id:     "waterways-river",
                type:   "line",
                source: "openmaptiles",
                "source-layer": "waterways",
                filter: ["==", "class", "river"],
                paint: {
                    "line-color": "#6badc8",
                    "line-width": ["interpolate", ["linear"], ["zoom"],
                        8, 1.0,  12, 2.5,  14, 4.0]
                }
            },
            {
                id:     "waterways-stream",
                type:   "line",
                source: "openmaptiles",
                "source-layer": "waterways",
                filter: ["==", "class", "stream"],
                minzoom: 11,
                paint: {
                    "line-color": "#8bbfd4",
                    "line-width": 1.0
                }
            },

            // ── Roads ────────────────────────────────────────────────────
            {
                id:     "roads-motorway-casing",
                type:   "line",
                source: "openmaptiles",
                "source-layer": "roads",
                filter: ["==", "class", "motorway"],
                paint: {
                    "line-color": "#e09050",
                    "line-width": ["interpolate", ["linear"], ["zoom"],
                        4, 1.5,  8, 3.0,  12, 6.0,  14, 9.0],
                }
            },
            {
                id:     "roads-motorway",
                type:   "line",
                source: "openmaptiles",
                "source-layer": "roads",
                filter: ["==", "class", "motorway"],
                paint: {
                    "line-color": "#f8c870",
                    "line-width": ["interpolate", ["linear"], ["zoom"],
                        4, 0.8,  8, 2.0,  12, 4.5,  14, 7.0],
                }
            },
            {
                id:     "roads-trunk",
                type:   "line",
                source: "openmaptiles",
                "source-layer": "roads",
                filter: ["==", "class", "trunk"],
                paint: {
                    "line-color": "#f8d898",
                    "line-width": ["interpolate", ["linear"], ["zoom"],
                        5, 0.6,  9, 1.8,  12, 4.0,  14, 6.0],
                }
            },
            {
                id:     "roads-primary",
                type:   "line",
                source: "openmaptiles",
                "source-layer": "roads",
                filter: ["==", "class", "primary"],
                paint: {
                    "line-color": "#ffe8a0",
                    "line-width": ["interpolate", ["linear"], ["zoom"],
                        7, 0.5,  10, 1.5,  12, 3.0,  14, 5.0],
                }
            },
            {
                id:     "roads-secondary",
                type:   "line",
                source: "openmaptiles",
                "source-layer": "roads",
                filter: ["==", "class", "secondary"],
                minzoom: 9,
                paint: {
                    "line-color": "#fff8d0",
                    "line-width": ["interpolate", ["linear"], ["zoom"],
                        9, 0.5,  12, 2.0,  14, 3.5],
                }
            },
            {
                id:     "roads-tertiary",
                type:   "line",
                source: "openmaptiles",
                "source-layer": "roads",
                filter: ["==", "class", "tertiary"],
                minzoom: 10,
                paint: {
                    "line-color": "#ffffff",
                    "line-width": ["interpolate", ["linear"], ["zoom"],
                        10, 0.4,  12, 1.2,  14, 2.5],
                }
            },
            {
                id:     "roads-minor",
                type:   "line",
                source: "openmaptiles",
                "source-layer": "roads",
                filter: ["in", "class", "minor", "track"],
                minzoom: 12,
                paint: {
                    "line-color": "#e8e8e8",
                    "line-width": ["interpolate", ["linear"], ["zoom"],
                        12, 0.5,  14, 1.5]
                }
            },
            {
                id:     "roads-path",
                type:   "line",
                source: "openmaptiles",
                "source-layer": "roads",
                filter: ["==", "class", "path"],
                minzoom: 13,
                paint: {
                    "line-color": "#c8b898",
                    "line-width": 1.0,
                    "line-dasharray": [3, 2]
                }
            },

            // ── Road labels ──────────────────────────────────────────────
            {
                id:     "road-labels",
                type:   "symbol",
                source: "openmaptiles",
                "source-layer": "roads",
                filter: ["has", "name"],
                minzoom: 12,
                layout: {
                    "symbol-placement": "line",
                    "text-field":  ["get", "name"],
                    "text-size":   11,
                    "text-font":   ["literal", ["Open Sans Regular"]],
                    "text-anchor": "center"
                },
                paint: {
                    "text-color":       "#444",
                    "text-halo-color":  "#fff",
                    "text-halo-width":  1.5
                }
            },

            // ── Place labels ─────────────────────────────────────────────
            {
                id:     "places-city",
                type:   "symbol",
                source: "openmaptiles",
                "source-layer": "places",
                filter: ["==", "class", "city"],
                layout: {
                    "text-field":  ["get", "name"],
                    "text-size":   ["interpolate", ["linear"], ["zoom"],
                        4, 11,  8, 14,  12, 16],
                    "text-font":   ["literal", ["Open Sans Bold"]],
                    "text-anchor": "center",
                    "text-max-width": 8
                },
                paint: {
                    "text-color":      "#333",
                    "text-halo-color": "#ffffffcc",
                    "text-halo-width": 2
                }
            },
            {
                id:     "places-town",
                type:   "symbol",
                source: "openmaptiles",
                "source-layer": "places",
                filter: ["==", "class", "town"],
                minzoom: 7,
                layout: {
                    "text-field":  ["get", "name"],
                    "text-size":   ["interpolate", ["linear"], ["zoom"],
                        7, 10,  12, 13],
                    "text-font":   ["literal", ["Open Sans SemiBold"]],
                    "text-anchor": "center"
                },
                paint: {
                    "text-color":      "#444",
                    "text-halo-color": "#ffffffcc",
                    "text-halo-width": 1.5
                }
            },
            {
                id:     "places-village",
                type:   "symbol",
                source: "openmaptiles",
                "source-layer": "places",
                filter: ["==", "class", "village"],
                minzoom: 9,
                layout: {
                    "text-field":  ["get", "name"],
                    "text-size":   11,
                    "text-font":   ["literal", ["Open Sans Regular"]],
                    "text-anchor": "center"
                },
                paint: {
                    "text-color":      "#555",
                    "text-halo-color": "#ffffffcc",
                    "text-halo-width": 1.5
                }
            },
            {
                id:     "places-hamlet",
                type:   "symbol",
                source: "openmaptiles",
                "source-layer": "places",
                filter: ["==", "class", "hamlet"],
                minzoom: 11,
                layout: {
                    "text-field":  ["get", "name"],
                    "text-size":   10,
                    "text-font":   ["literal", ["Open Sans Regular"]],
                    "text-anchor": "center"
                },
                paint: {
                    "text-color":      "#666",
                    "text-halo-color": "#ffffffcc",
                    "text-halo-width": 1.5
                }
            }
        ],

        // MapLibre needs a glyph source for symbol layers.
        // These are bundled locally in assets/web/fonts/ (see INTEGRATION.md §4).
        glyphs: "https://appassets.androidplatform.net/assets/web/fonts/{fontstack}/{range}.pbf"
    };
}

/* ------------------------------------------------------------------ */
/*  Initialisation                                                     */
/* ------------------------------------------------------------------ */

function map_init(containerId) {
    if (map_instance) {
        map_instance.resize();
        return;
    }
    if (typeof maplibregl === "undefined") {
        console.error("map.js: maplibregl not loaded");
        return;
    }
    // Ask Kotlin if an offline MBTiles file exists.
    // map_on_mbtiles_status() will be called back and then call _map_create().
    // If Android bridge is absent (browser testing) go straight to online tiles.
    if (typeof Android !== "undefined") {
        _map_pending_container = containerId;
        Android.onFrontendRequest("map:mbtiles:check");
    } else {
        _map_create(containerId, false);
    }
}

var _map_pending_container = null;

// Called by Kotlin via eval("map_on_mbtiles_status(true|false)")
function map_on_mbtiles_status(hasMbtiles) {
    _use_mbtiles = hasMbtiles;
    _map_create(_map_pending_container, hasMbtiles);
    _map_pending_container = null;
}

function _map_create(containerId, useMbtiles) {
    map_instance = new maplibregl.Map({
        container:          containerId,
        style:              useMbtiles ? _vector_style() : _osm_style(),
        center:             MAP_DEFAULT_CENTER,
        zoom:               MAP_DEFAULT_ZOOM,
        attributionControl: false
    });

    map_instance.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map_instance.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");
    map_instance.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: "metric" }), "bottom-left");

    map_instance.on("load", function () {
        map_ready = true;
        // Load saved pins from Kotlin persistent storage
        if (typeof Android !== "undefined") {
            Android.onFrontendRequest("map:pins:load");
        }
        map_ui_on_ready();
    });
}

function map_destroy() {
    map_stop_geolocation();
    if (map_instance) { map_instance.remove(); map_instance = null; }
    _pin_markers  = {};
    _my_marker    = null;
    map_ready     = false;
}

function map_on_panel_show() {
    if (map_instance) setTimeout(function () { map_instance.resize(); }, 50);
}

/* ------------------------------------------------------------------ */
/*  Navigation                                                         */
/* ------------------------------------------------------------------ */

function map_fly_to(lon, lat, zoom) {
    if (!map_instance) return;
    map_instance.flyTo({ center: [lon, lat], zoom: zoom || MAP_DEFAULT_ZOOM, essential: true });
}

function map_zoom_in()    { if (map_instance) map_instance.zoomIn(); }
function map_zoom_out()   { if (map_instance) map_instance.zoomOut(); }
function map_reset_view() { map_fly_to(MAP_DEFAULT_CENTER[0], MAP_DEFAULT_CENTER[1], MAP_DEFAULT_ZOOM); }

/* ------------------------------------------------------------------ */
/*  Geolocation                                                        */
/* ------------------------------------------------------------------ */

function map_start_geolocation(follow) {
    if (!navigator.geolocation) { /*map_ui_show_toast("Geolocation not supported."); return; */}
    if (_geo_watch_id !== null) return;
    _geo_watch_id = navigator.geolocation.watchPosition(
        function (pos) {
            _update_my_position(pos.coords.longitude, pos.coords.latitude);
            if (follow) map_fly_to(pos.coords.longitude, pos.coords.latitude, 15);
        },
        function (err) { console.log("Location error: " + err.message) /*map_ui_show_toast("Location error: " + err.message);*/ },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
}

function map_stop_geolocation() {
    if (_geo_watch_id !== null) {
        navigator.geolocation.clearWatch(_geo_watch_id);
        _geo_watch_id = null;
    }
}

function _update_my_position(lon, lat) {
    if (!map_instance || !map_ready) return;
    if (_my_marker) {
        _my_marker.setLngLat([lon, lat]);
    } else {
        var el = document.createElement("div");
        el.className = "map-my-location-dot";
        _my_marker = new maplibregl.Marker({ element: el, anchor: "center" })
            .setLngLat([lon, lat]).addTo(map_instance);
    }
}

/* ------------------------------------------------------------------ */
/*  Pins                                                               */
/* ------------------------------------------------------------------ */

function _pin_id() {
    return Math.random().toString(36).slice(2, 9);
}

/**
 * Add a new pin at lon/lat with title and comment.
 * Opens the edit overlay immediately so the user can fill in details.
 */
function map_add_pin(lon, lat) {
    var id = _pin_id();
    map_pins[id] = { id: id, lon: lon, lat: lat, title: "", comment: "", ts: Date.now() };
    _render_pin(id);
    _save_pins();
    map_ui_open_pin_editor(id);   // let the user fill title/comment
}

/**
 * Update title/comment for an existing pin and re-save.
 */
function map_update_pin(id, title, comment) {
    if (!map_pins[id]) return;
    map_pins[id].title   = title;
    map_pins[id].comment = comment;
    // Refresh popup text
    if (_pin_markers[id]) {
        _pin_markers[id].getPopup().setHTML(_pin_popup_html(map_pins[id]));
    }
    _save_pins();
}

function map_delete_pin(id) {
    if (_pin_markers[id]) { _pin_markers[id].remove(); delete _pin_markers[id]; }
    delete map_pins[id];
    _save_pins();
    //map_ui_show_toast("Pin removed.");
}

function _render_pin(id) {
    if (!map_instance || !map_ready) return;
    var pin = map_pins[id];
    if (!pin) return;

    var el = document.createElement("div");
    el.className = "map-pin-marker";
    el.title = pin.title || "Pin";

    var popup = new maplibregl.Popup({ offset: 24, closeButton: false, maxWidth: "220px" })
        .setHTML(_pin_popup_html(pin));

    var marker = new maplibregl.Marker({ element: el, anchor: "bottom", draggable: true })
        .setLngLat([pin.lon, pin.lat])
        .setPopup(popup)
        .addTo(map_instance);

    // Show popup on tap/click
    el.addEventListener("click", function (e) {
        e.stopPropagation();
        marker.togglePopup();
    });

    // Update coordinates when dragged
    marker.on("dragend", function () {
        var lngLat = marker.getLngLat();
        map_pins[id].lon = lngLat.lng;
        map_pins[id].lat = lngLat.lat;
        _save_pins();
    });

    _pin_markers[id] = marker;
}

function _pin_popup_html(pin) {
    return "<div class='map-popup'>" +
        "<strong>" + _esc(pin.title || "(no title)") + "</strong>" +
        (pin.comment ? "<p>" + _esc(pin.comment) + "</p>" : "") +
        "<div class='map-popup-actions'>" +
        "<button onclick='map_ui_open_pin_editor(\"" + pin.id + "\")'>Edit</button>" +
        "<button onclick='map_delete_pin(\"" + pin.id + "\")'>Delete</button>" +
        "</div></div>";
}

/* ── Persistence ── */

function _save_pins() {
    var arr = Object.values(map_pins);
    var json = JSON.stringify(arr);
    if (typeof Android !== "undefined") {
        var b64 = btoa(unescape(encodeURIComponent(json)));
        Android.onFrontendRequest("map:pins:save " + b64);
    }
}

// Called by Kotlin: eval("map_on_pins_loaded('<base64>')")
function map_on_pins_loaded(b64) {
    try {
        var json = decodeURIComponent(escape(atob(b64)));
        var arr  = JSON.parse(json);
        arr.forEach(function (pin) {
            map_pins[pin.id] = pin;
            _render_pin(pin.id);  // map_ready is true by this point (called from 'load' handler)
        });
        //map_ui_show_toast(arr.length + " pin(s) loaded.");
    } catch (e) {
        console.error("map_on_pins_loaded: parse error", e);
    }
}

/* ── Long-press on map to place a pin ── */
function _map_setup_longpress() {
    if (!map_instance) return;
    var _press_timer = null;

    map_instance.on("mousedown", function (e) {
        _press_timer = setTimeout(function () {
            map_add_pin(e.lngLat.lng, e.lngLat.lat);
        }, 600);
    });
    map_instance.on("mouseup",   function () { clearTimeout(_press_timer); });
    map_instance.on("mousemove", function () { clearTimeout(_press_timer); });
    // Touch events for mobile
    map_instance.on("touchstart", function (e) {
        if (e.originalEvent.touches.length !== 1) return;
        _press_timer = setTimeout(function () {
            var t = e.originalEvent.changedTouches[0];
            var pt = map_instance.unproject([t.clientX, t.clientY]);
            map_add_pin(pt.lng, pt.lat);
        }, 600);
    });
    map_instance.on("touchend",  function () { clearTimeout(_press_timer); });
    map_instance.on("touchmove", function () { clearTimeout(_press_timer); });
}

/* ------------------------------------------------------------------ */
/*  Utilities                                                          */
/* ------------------------------------------------------------------ */

function _esc(s) {
    return String(s)
        .replace(/&/g,"&amp;").replace(/</g,"&lt;")
        .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

/* eof */