# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

This is `koustubh1012.github.io` — a static personal portfolio site served directly via GitHub Pages. There is no build tooling, no package manager, and no test suite. It's based on the "Editorial" template by HTML5 UP (see `README.txt` for template credits/license).

## Development workflow

There is no build step. Edit the HTML/CSS/JS files directly and open them in a browser (or use a static file server, e.g. `python3 -m http.server`) to preview changes. Since it's plain static HTML/CSS/JS, there is no lint, test, or compile command to run.

- `index.html` is the live portfolio page (title "Koustubh's Portfolio") — this is the file that matters.
- `elements.html` and `generic.html` are unused template boilerplate pages carried over from HTML5 UP's Editorial template (style/element reference pages). They are not linked from the live site's navigation and generally don't need to be touched.

## Architecture

- **Single-page layout**: `index.html` is a one-page scrolling site built from stacked `<section>` blocks with anchor IDs (`#banner`, `#projects`, `#work-experience`, `#skills`, etc.). The nav menu (in the sidebar `<div id="menu">`) links to these anchors rather than separate pages.
- **CSS**: `assets/css/main.css` is the compiled output of the Sass source in `assets/sass/`. If you need to change styling, prefer editing the Sass source (`assets/sass/main.scss` and its partials under `base/`, `components/`, `layout/`, `libs/`) and recompiling, since `main.css` is generated — but there is no Sass compiler wired into this repo, so in practice styling tweaks are often made directly in `assets/css/main.css`. Be aware of this drift if editing one without the other.
- **JS**: `assets/js/main.js` is the template's own interaction logic (sidebar menu toggle, scrolling nav, etc.); `util.js`, `breakpoints.min.js`, and `browser.min.js` are HTML5 UP helper libraries. `jquery.min.js` is a dependency for all of the above.
- **Assets**: `images/` holds photos/logos/GIFs referenced from `index.html` (project screenshots, employer logos, etc.). `Koustubh_Resume.pdf` is linked directly from the site.
- **Fonts/icons**: Font Awesome is vendored under `assets/webfonts/` and `assets/css/fontawesome-all.min.css`.

## Making content changes

Most real edits to this repo are content changes to `index.html` — adding/editing projects, work experience entries, or skills sections. These are plain HTML edits within the existing section structure; there's no templating engine or data file driving the content.
