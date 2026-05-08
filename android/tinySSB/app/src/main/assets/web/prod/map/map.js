/*
    prod/map/map.js

    Core logic for the MapLibre map component.
    Mirrors the structure of prod/kanban/board.js.

    Responsibilities:
      - Initialise / tear-down the MapLibre GL map instance
      - Own all map state (markers, layers, current position)
      - Expose a clean API that map_ui.js calls for every user action
      - Bridge calls to/from the Android/tinySSB backend via Android.*

    Loaded by tremola.html together with map_ui.js and
    the MapLibre assets in util/maplibre-gl.js.
*/

"use strict";

/* ------------------------------------------------------------------ */
/*  Module-level state                                                 */
/* ------------------------------------------------------------------ */

var map_instance   = null;   // the MapLibre Map object
var map_markers    = {};     // { id: { marker, data } }
var map_my_marker  = null;   // GeolocateControl / manual position marker
var map_ready      = false;  // true once 'load' fires

/* Default view – centre of Europe, zoom 4 */
var MAP_DEFAULT_CENTER = [8.5417, 47.3769]; // Zurich
var MAP_DEFAULT_ZOOM   = 12;

/* OSM raster tile style (no token needed, works immediately) */
var MAP_OSM_STYLE = {
    version: 8,
    sources: {
        osm: {
            type:        "raster",
            tiles:       ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize:    256,
            attribution: "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors",
            maxzoom:     19
        }
    },
    layers: [{
        id:     "osm-tiles",
        type:   "raster",
        source: "osm",
        minzoom: 0,
        maxzoom: 24
    }]
};

/* ------------------------------------------------------------------ */
/*  Initialisation                                                     */
/* ------------------------------------------------------------------ */

/**
 * Called once by map_ui.js when the map panel is first shown.
 * Safe to call multiple times – skips re-init if already initialised.
 *
 * @param {string} containerId  – DOM id of the <div> that will hold the map
 */
function map_init(containerId) {
    if (map_instance) {
        // already initialised – just resize in case the panel was hidden
        map_instance.resize();
        return;
    }

    /* maplibregl is loaded from util/maplibre-gl.js (see tremola.html) */
    if (typeof maplibregl === "undefined") {
        console.error("map.js: maplibregl not loaded");
        return;
    }

    map_instance = new maplibregl.Map({
        container:   containerId,
        style:       MAP_OSM_STYLE,
        center:      MAP_DEFAULT_CENTER,
        zoom:        MAP_DEFAULT_ZOOM,
        attributionControl: false   // we add a compact one below
    });

    /* Compact attribution in the bottom-right */
    map_instance.addControl(
        new maplibregl.AttributionControl({ compact: true }),
        "bottom-right"
    );

    /* Navigation control (zoom +/-, compass) */
    map_instance.addControl(
        new maplibregl.NavigationControl({ showCompass: true }),
        "top-right"
    );

    /* Scale bar */
    map_instance.addControl(
        new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }),
        "bottom-left"
    );

    map_instance.on("load", function () {
        map_ready = true;
        console.log("map.js: map loaded");
        map_ui_on_ready();          // notify the UI layer
    });

    map_instance.on("error", function (e) {
        console.error("map.js: map error", e);
    });
}

/**
 * Call when the panel is hidden to free GPU resources.
 * A subsequent map_init() call will re-create the instance.
 */
function map_destroy() {
    if (map_instance) {
        map_instance.remove();
        map_instance  = null;
        map_markers   = {};
        map_my_marker = null;
        map_ready     = false;
    }
}

/**
 * Must be called whenever the map panel becomes visible again
 * (e.g. the user switches back from another panel).
 * MapLibre needs a resize event to repaint correctly.
 */
function map_on_panel_show() {
    if (map_instance) {
        setTimeout(function () { map_instance.resize(); }, 50);
    }
}

/* ------------------------------------------------------------------ */
/*  Navigation helpers                                                 */
/* ------------------------------------------------------------------ */

function map_fly_to(lon, lat, zoom) {
    if (!map_instance) return;
    map_instance.flyTo({
        center:    [lon, lat],
        zoom:      zoom || MAP_DEFAULT_ZOOM,
        essential: true
    });
}

function map_zoom_in() {
    if (map_instance) map_instance.zoomIn();
}

function map_zoom_out() {
    if (map_instance) map_instance.zoomOut();
}

function map_reset_view() {
    map_fly_to(MAP_DEFAULT_CENTER[0], MAP_DEFAULT_CENTER[1], MAP_DEFAULT_ZOOM);
}

/* ------------------------------------------------------------------ */
/*  Geolocation                                                        */
/* ------------------------------------------------------------------ */

var _geo_watch_id = null;

/**
 * Start watching the device position.
 * Updates a blue "you are here" marker and optionally follows the user.
 *
 * @param {boolean} follow  – if true, the map pans to keep the user centred
 */
function map_start_geolocation(follow) {
    if (!navigator.geolocation) {
        map_ui_show_toast("Geolocation not supported on this device.");
        return;
    }

    if (_geo_watch_id !== null) return;   // already watching

    _geo_watch_id = navigator.geolocation.watchPosition(
        function (pos) {
            var lon = pos.coords.longitude;
            var lat = pos.coords.latitude;
            _update_my_position(lon, lat);
            if (follow) map_fly_to(lon, lat, 15);
        },
        function (err) {
            console.warn("map.js: geolocation error", err.message);
            map_ui_show_toast("Location unavailable: " + err.message);
        },
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

    if (map_my_marker) {
        map_my_marker.setLngLat([lon, lat]);
    } else {
        /* Blue pulsing dot for "my position" */
        var el = document.createElement("div");
        el.className = "map-my-location-dot";

        map_my_marker = new maplibregl.Marker({ element: el, anchor: "center" })
            .setLngLat([lon, lat])
            .addTo(map_instance);
    }
}

/* ------------------------------------------------------------------ */
/*  Markers (peers / points of interest)                              */
/* ------------------------------------------------------------------ */

/**
 * Add or update a named marker on the map.
 *
 * @param {string} id    – stable identifier (e.g. peer pub-key)
 * @param {number} lon
 * @param {number} lat
 * @param {object} data  – { label, color, description }
 */
function map_set_marker(id, lon, lat, data) {
    if (!map_instance || !map_ready) return;

    data = data || {};

    if (map_markers[id]) {
        map_markers[id].marker.setLngLat([lon, lat]);
        map_markers[id].data = data;
    } else {
        var el = document.createElement("div");
        el.className = "map-peer-marker";
        el.style.backgroundColor = data.color || "var(--passiveCol)";
        el.title = data.label || id;

        var popup = new maplibregl.Popup({ offset: 20, closeButton: true })
            .setHTML(
                "<div class='map-popup'>" +
                "<strong>" + _esc(data.label || id) + "</strong>" +
                (data.description
                    ? "<p>" + _esc(data.description) + "</p>"
                    : "") +
                "</div>"
            );

        var marker = new maplibregl.Marker({ element: el, anchor: "center" })
            .setLngLat([lon, lat])
            .setPopup(popup)
            .addTo(map_instance);

        map_markers[id] = { marker: marker, data: data };
    }
}

function map_remove_marker(id) {
    if (map_markers[id]) {
        map_markers[id].marker.remove();
        delete map_markers[id];
    }
}

function map_clear_markers() {
    Object.keys(map_markers).forEach(function (id) {
        map_markers[id].marker.remove();
    });
    map_markers = {};
}

/* ------------------------------------------------------------------ */
/*  tinySSB / Android bridge                                          */
/* ------------------------------------------------------------------ */

/**
 * Called by the Kotlin layer (via evaluateJavascript) when a peer
 * broadcasts its GPS position over the tinySSB feed.
 *
 * Example call from Kotlin:
 *   webView.evaluateJavascript("map_on_peer_location('abc123', 8.54, 47.37, 'Alice')", null)
 */
function map_on_peer_location(peerId, lon, lat, alias) {
    map_set_marker(peerId, lon, lat, {
        label:       alias || peerId.substring(0, 8),
        color:       "var(--lightA)",
        description: "tinySSB peer"
    });
}

/**
 * Broadcast our own GPS position as a tinySSB map event.
 * The Android layer must implement Android.publishMapLocation(lon, lat).
 */
function map_publish_my_location() {
    map_start_geolocation(false);   // ensure we have a position

    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(function (pos) {
        var lon = pos.coords.longitude;
        var lat = pos.coords.latitude;

        if (typeof Android !== "undefined" && Android.publishMapLocation) {
            Android.publishMapLocation(lon, lat);
            map_ui_show_toast("Location shared with peers.");
        } else {
            /* Dev/browser fallback */
            console.log("map.js: would publish", lon, lat);
            map_ui_show_toast("(Dev mode) location: " + lat.toFixed(4) + ", " + lon.toFixed(4));
        }
    }, function (err) {
        map_ui_show_toast("Cannot get position: " + err.message);
    });
}

/* ------------------------------------------------------------------ */
/*  Utilities                                                          */
/* ------------------------------------------------------------------ */

function _esc(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/* eof */
