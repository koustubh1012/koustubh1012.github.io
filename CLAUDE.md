# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

This is `koustubh1012.github.io` — a static personal portfolio site served directly via GitHub Pages. There is no build tooling, no package manager, and no test suite.

The live site (`index.html`) is an interactive 3D "robot game": the visitor drives a TurtleBot-style robot around a lab arena (three.js) and docks at stations (About, Experience, Projects, Skills, Contact) to open content panels.

## Development workflow

There is no build step. Edit the HTML/CSS/JS files directly and preview with a static file server — `python3 -m http.server` from the repo root, then open http://localhost:8000. Opening `index.html` via `file://` will NOT work because the game is loaded as ES modules; it will fall back to the static layout.

- `index.html` is the live portfolio page (title "Koustubh's Portfolio") — this is the file that matters.
- `elements.html` and `generic.html` are unused boilerplate from the HTML5 UP "Editorial" template the site used to be based on. They still use `assets/css/main.css`, `assets/sass/` and `assets/js/*` (jQuery etc.); the live page no longer uses any of those.

## Architecture

- **Content lives in `index.html`** as `<section class="panel" id="about|experience|projects|skills|contact" data-station="...">` blocks inside `<main id="panels">`. In the game they are slide-in panels opened when the robot docks; if WebGL/JS/modules are unavailable, the `.fallback` / `.no-js` CSS classes render the same sections as a normal scrolling page. Panel IDs must match the station IDs in `assets/game/world.js` (`STATIONS`).
- **Game code** is plain ES modules in `assets/game/` (no bundler):
  - `main.js` — entry point: renderer/camera, main loop, input (WASD/arrows, click/tap nav goals, 1–5 shortcuts, Enter to dock, Esc), docking, panels, HUD, minimap, URL hash deep links (`#projects`, plus aliases `#banner`/`#work-experience` from the old site).
  - `world.js` — arena layout: `STATIONS` (id, label, color, pad position), obstacles, walls, and the per-station 3D monuments. Each obstacle registers a collider (`boxes`/`circles`) used for physics, lidar and path planning — keep visuals and colliders in sync when moving things.
  - `robot.js` — robot model + differential-drive kinematics and heading controller.
  - `nav.js` — occupancy grid + A* planner with line-of-sight smoothing (inflated by robot radius).
  - `lidar.js` — simulated 2D lidar (ray casting against colliders) and the SLAM-style minimap.
  - `game.css` — HUD, panels, intro, responsive/mobile rules and the static fallback styles.
  - `vendor/three.module.min.js` — vendored three.js r160 (single-file module build).
- **Assets**: `images/` holds photos/logos/GIFs referenced from `index.html`. `images/kstb_small.jpg` is a downscaled, EXIF-rotated copy of `kstb.jpeg` used for the About panel and the hologram texture. `Koustubh_Resume.pdf` is linked directly from the site.
- **Fonts/icons**: Font Awesome 5 is vendored under `assets/webfonts/` and `assets/css/fontawesome-all.min.css`; text fonts (Inter, Space Grotesk, JetBrains Mono) come from Google Fonts.

## Making content changes

Most edits are content changes to the panel sections in `index.html` (projects, work experience entries, skills chips). These are plain HTML; there's no templating engine or data file. Adding a new station requires a matching entry in `STATIONS` and a monument builder in `world.js`, a nav button in `.hud-nav`, and a panel section in `index.html`; check new positions stay reachable (pads must not overlap colliders).
