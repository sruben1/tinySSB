//map_ui.js

"use strict";

var map_instance  = null;
var map_ready     = false;
var MAP_DEFAULT_CENTER = [7.590556, 47.554722];
var MAP_DEFAULT_ZOOM   = 10;

var _map_state = {centre: MAP_DEFAULT_CENTER, zoom: MAP_DEFAULT_ZOOM};

//===========================
// INIT/MANAGEMENT PROCEDURES
//===========================

function map_init() {
    launch_snackbar("Init map now...");
    //document.getElementById("div:social-map").style.display = 'map-container';
    if (typeof maplibregl === "undefined") { // safety
        console.error("map.js: MapLibre GL not loaded");
        return;
    }

    if (!map_instance) {
        _map_create();
        map_refresh_resize();
    } else {
        // Already initialised – restore the saved viewport and trigger a resize
        // in case the panel dimensions changed while it was hidden.
        map_instance.setCenter(_map_state.centre);
        map_instance.setZoom(_map_state.zoom);
        map_refresh_resize();
    }
}

function _map_create() {
    map_instance = new maplibregl.Map({
        container: "div:social-map",
        style: "https://appassets.androidplatform.net/assets/web/prod/map/BaseMapStyling.json",
        center: MAP_DEFAULT_CENTER,
        zoom: MAP_DEFAULT_ZOOM,
        attributionControl: false,
        renderWorldCopies: false
    });

    map_instance.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map_instance.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");
    map_instance.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: "metric" }), "bottom-left");

    // Once map loads, set to true...
    map_instance.on('load', () => { map_ready = true; });

    _map_setup_longpress();
}

function map_destroy() {
    if (map_instance) {
        map_instance.remove();
        map_instance = null;
    }
    map_ready     = false;
}

function map_refresh_resize() {
    if (map_instance) {
        setTimeout(function() { map_instance.resize(); }, 50);
    }
}

//=======================================
// ADVANCED FUNCTIONALITY (POI-pins etc.)
//=======================================

function _pin_id() {
    return Math.random().toString(36).slice(2, 9);
}

/**
 * Add a new pin at lon/lat with title and comment. Prompts the user
 * to input these in an overlay dialog.
 */
function map_add_pin(lon, lat) {
    //TODO
    launch_snackbar(`Adding pins will be added soon... lat:${lat.toString()}, lon:${lon.toString()}`);
}


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
