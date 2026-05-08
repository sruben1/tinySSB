/*
    prod/map/map_ui.js

    UI layer for the MapLibre map component.
    Mirrors the structure of prod/kanban/board_ui.js.

    Responsibilities:
      - Build / update the panel DOM
      - Handle all button clicks and overlay toggling
      - Call map.js functions in response to user actions
      - Receive callbacks from map.js and update the UI accordingly

    Convention: all exported symbols start with "map_ui_"
    Internal helpers start with "_map_ui_"
*/

"use strict";

/* ------------------------------------------------------------------ */
/*  Panel registration                                                 */
/* ------------------------------------------------------------------ */

/**
 * Called once at startup by tremola.js to register this component.
 * Follows the same pattern used by other prod/ panels.
 */
function map_ui_register() {
    /* Register in the global prod registry if it exists */
    if (typeof prod_register === "function") {
        prod_register("map", {
            label:    "Map",
            icon:     "prod/map/map.svg",
            show:     map_ui_show_panel,
            hide:     map_ui_hide_panel
        });
    }
}

/* ------------------------------------------------------------------ */
/*  Panel lifecycle                                                    */
/* ------------------------------------------------------------------ */

var _map_panel_built = false;

function map_ui_show_panel() {
    _map_ui_ensure_panel();

    /* Hide all other panels first (same pattern as kanban) */
    if (typeof hide_panels === "function") hide_panels();

    document.getElementById("map-panel").style.display = "flex";

    /* Initialise the map the first time; just resize on subsequent shows */
    map_init("map-container");
    map_on_panel_show();
}

function map_ui_hide_panel() {
    var panel = document.getElementById("map-panel");
    if (panel) panel.style.display = "none";
    map_stop_geolocation();
}

/* ------------------------------------------------------------------ */
/*  DOM construction                                                   */
/* ------------------------------------------------------------------ */

/**
 * Build the panel HTML once and inject it into <body>.
 * After the first call this is a no-op.
 */
function _map_ui_ensure_panel() {
    if (_map_panel_built) return;
    _map_panel_built = true;

    var panel = document.createElement("div");
    panel.id        = "map-panel";
    panel.className = "map-panel";
    panel.style.display = "none";

    panel.innerHTML = [
        /* ── Header bar ──────────────────────────────────────────── */
        '<div class="map-header">',
        '  <button class="flat map-back-btn" onclick="map_ui_on_back()"',
        '          title="Back">&#8592;</button>',
        '  <span class="map-title">Map</span>',
        '  <button class="flat map-menu-btn" onclick="_map_ui_toggle_menu()"',
        '          title="Options">&#8942;</button>',
        '</div>',

        /* ── Map container ────────────────────────────────────────── */
        '<div id="map-container" class="map-container"></div>',

        /* ── Floating action buttons (bottom-left stack) ─────────── */
        '<div class="map-fab-stack">',
        '  <button class="map-fab" id="map-fab-locate"',
        '          onclick="_map_ui_on_locate()" title="My location">',
        '    &#x2316;',   /* ⌖ target symbol */
        '  </button>',
        '  <button class="map-fab" id="map-fab-share"',
        '          onclick="map_publish_my_location()" title="Share my location">',
        '    &#x2B06;',   /* ⬆ */
        '  </button>',
        '  <button class="map-fab" id="map-fab-reset"',
        '          onclick="map_reset_view()" title="Reset view">',
        '    &#x2302;',   /* ⌂ */
        '  </button>',
        '</div>',

        /* ── Dropdown menu overlay ────────────────────────────────── */
        '<div id="map-menu" class="map-menu-overlay" style="display:none">',
        '  <button class="menu_item_button"',
        '          onclick="_map_ui_toggle_peers(); _map_ui_close_menu()">',
        '    Show / hide peer markers',
        '  </button>',
        '  <button class="menu_item_button"',
        '          onclick="map_clear_markers(); _map_ui_close_menu()">',
        '    Clear all markers',
        '  </button>',
        '  <button class="menu_item_button"',
        '          onclick="map_reset_view(); _map_ui_close_menu()">',
        '    Reset view',
        '  </button>',
        '</div>',

        /* Transparent click-catcher to close the menu */
        '<div id="map-menu-bg" class="overlay-trans"',
        '     onclick="_map_ui_close_menu()" style="display:none"></div>',

        /* ── Toast notification ───────────────────────────────────── */
        '<div id="map-toast" class="map-toast" style="display:none"></div>'

    ].join("\n");

    document.body.appendChild(panel);
}

/* ------------------------------------------------------------------ */
/*  Header actions                                                     */
/* ------------------------------------------------------------------ */

function map_ui_on_back() {
    map_ui_hide_panel();
    /* Return to the previous screen the same way other panels do */
    if (typeof back_btn === "function") back_btn();
    else if (typeof show_menu === "function") show_menu();
}

/* ------------------------------------------------------------------ */
/*  Floating-button handlers                                           */
/* ------------------------------------------------------------------ */

var _locating = false;

function _map_ui_on_locate() {
    _locating = !_locating;
    var btn = document.getElementById("map-fab-locate");

    if (_locating) {
        btn.classList.add("map-fab-active");
        map_start_geolocation(true);
    } else {
        btn.classList.remove("map-fab-active");
        map_stop_geolocation();
    }
}

/* ------------------------------------------------------------------ */
/*  Menu overlay                                                       */
/* ------------------------------------------------------------------ */

function _map_ui_toggle_menu() {
    var menu = document.getElementById("map-menu");
    var bg   = document.getElementById("map-menu-bg");
    var open = menu.style.display !== "none";
    menu.style.display = open ? "none" : "block";
    bg.style.display   = open ? "none" : "block";
}

function _map_ui_close_menu() {
    var menu = document.getElementById("map-menu");
    var bg   = document.getElementById("map-menu-bg");
    if (menu) menu.style.display = "none";
    if (bg)   bg.style.display   = "none";
}

/* ------------------------------------------------------------------ */
/*  Peer marker toggle                                                 */
/* ------------------------------------------------------------------ */

var _peers_visible = true;

function _map_ui_toggle_peers() {
    _peers_visible = !_peers_visible;
    Object.values(map_markers).forEach(function (entry) {
        var el = entry.marker.getElement();
        el.style.display = _peers_visible ? "" : "none";
    });
}

/* ------------------------------------------------------------------ */
/*  Toast notifications                                                */
/* ------------------------------------------------------------------ */

var _toast_timer = null;

/**
 * Show a brief non-blocking notification at the bottom of the map panel.
 * Called by map.js via map_ui_show_toast().
 */
function map_ui_show_toast(msg) {
    var toast = document.getElementById("map-toast");
    if (!toast) return;

    toast.textContent  = msg;
    toast.style.display = "block";
    toast.classList.add("map-toast-show");

    if (_toast_timer) clearTimeout(_toast_timer);
    _toast_timer = setTimeout(function () {
        toast.classList.remove("map-toast-show");
        toast.style.display = "none";
    }, 3000);
}

/* ------------------------------------------------------------------ */
/*  Callbacks invoked by map.js                                        */
/* ------------------------------------------------------------------ */

/** Called by map.js once the MapLibre 'load' event fires. */
function map_ui_on_ready() {
    console.log("map_ui.js: map is ready");
    /* Could e.g. load saved markers from the tinySSB log here */
}

/* eof */
