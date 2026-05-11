function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildMapHtml(title: string): string {
  const escapedTitle = escapeHtml(title);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapedTitle}</title>
    <link rel="stylesheet" href="/leaflet.css" />
    <link rel="stylesheet" href="/app.css" />
  </head>
  <body>
    <div class="shell" id="app-shell">
      <aside class="panel" id="map-sidebar">
        <header class="panel-header">
          <div class="eyebrow">TAKCLI Map Console</div>
          <h1>${escapedTitle}</h1>
          <p class="lede">Live TAK visibility, lightweight server controls, and replay overlays in one local console.</p>
          <div class="logo-card">
            <img src="/company-logo.svg" alt="Company logo placeholder" class="logo-image" />
            <div>
              <div class="logo-label">Company Logo Slot</div>
              <div class="logo-copy">Replace this placeholder with your real brand asset when you are ready.</div>
            </div>
          </div>
        </header>

        <section class="card card-meta">
          <div class="card-title-row">
            <h2>Session</h2>
            <span class="status-pill" id="status-pill">Booting</span>
          </div>
          <dl class="meta-grid">
            <div>
              <dt>Profile</dt>
              <dd id="meta-profile">-</dd>
            </div>
            <div>
              <dt>Server</dt>
              <dd id="meta-server">-</dd>
            </div>
            <div>
              <dt>CoT Port</dt>
              <dd id="meta-cot-port">-</dd>
            </div>
            <div>
              <dt>Replay</dt>
              <dd id="meta-replay">None</dd>
            </div>
          </dl>
          <div class="button-row">
            <button id="refresh-status" type="button">Refresh Status</button>
            <button id="refresh-targets" type="button">Refresh Targets</button>
            <button id="toggle-live" type="button" class="button-accent">Start Live Feed</button>
          </div>
        </section>

        <section class="card">
          <div class="card-title-row">
            <h2>Replay</h2>
            <span class="metric" id="replay-state">No replay</span>
          </div>
          <div class="status-note" id="replay-role-note">
            Primary workflow: <code>takcli start map</code> + <code>takcli start replay</code>. Local replay overlay
            playback in <code>takcli map --replay-file ...</code> remains available as a secondary inspection and demo mode.
          </div>
          <dl class="meta-grid replay-telemetry-grid">
            <div>
              <dt>Injection Status</dt>
              <dd id="replay-injection-status">Idle</dd>
            </div>
            <div>
              <dt>Sent Events</dt>
              <dd id="replay-sent-events">0</dd>
            </div>
            <div>
              <dt>Inject Speed</dt>
              <dd id="replay-inject-speed">-</dd>
            </div>
            <div>
              <dt>Last Source Time</dt>
              <dd id="replay-last-source-time">-</dd>
            </div>
          </dl>
          <dl class="meta-grid replay-meta-grid">
            <div>
              <dt>Time</dt>
              <dd id="replay-time">-</dd>
            </div>
            <div>
              <dt>Visible</dt>
              <dd id="replay-visible">0 vessels</dd>
            </div>
            <div>
              <dt>Speed</dt>
              <dd id="replay-speed-readout">-</dd>
            </div>
            <div>
              <dt>Range</dt>
              <dd id="replay-range">-</dd>
            </div>
          </dl>
          <label class="range-field">
            <span>Playback Position</span>
            <input id="replay-scrubber" type="range" min="0" max="1000" step="1" value="0" disabled />
          </label>
          <div class="button-row">
            <button id="replay-toggle" type="button" disabled>Play</button>
            <button id="replay-restart" type="button" disabled>Restart</button>
            <button id="replay-fit" type="button" disabled>Fit Replay</button>
          </div>
          <div class="field-row">
            <label>
              <span>Playback Speed</span>
              <select id="replay-speed" disabled>
                <option value="1">1x realtime</option>
                <option value="60">1m / sec</option>
                <option value="600">10m / sec</option>
                <option value="3600">1h / sec</option>
                <option value="21600">6h / sec</option>
                <option value="86400" selected>1d / sec</option>
                <option value="604800">1w / sec</option>
              </select>
            </label>
            <label>
              <span>Marker Symbology</span>
              <select id="marker-mode">
                <option value="dots" selected>Dots</option>
                <option value="2525">2525-style</option>
              </select>
            </label>
          </div>
          <div class="toggle-row">
            <label class="checkbox-row">
              <input id="replay-show-trails" type="checkbox" checked />
              <span>Show short trails</span>
            </label>
            <label class="checkbox-row">
              <input id="replay-auto-follow" type="checkbox" />
              <span>Auto-follow movement</span>
            </label>
          </div>
        </section>

        <section class="card">
          <div class="card-title-row">
            <h2>Layers</h2>
            <span class="metric">Visibility</span>
          </div>
          <div class="toggle-row">
            <label class="checkbox-row">
              <input id="layer-live-markers" type="checkbox" checked />
              <span>Live markers</span>
            </label>
            <label class="checkbox-row">
              <input id="layer-live-tracks" type="checkbox" checked />
              <span>Live tracks</span>
            </label>
            <label class="checkbox-row">
              <input id="layer-replay-tracks" type="checkbox" checked />
              <span>Replay tracks</span>
            </label>
            <label class="checkbox-row">
              <input id="replay-show-history" type="checkbox" />
              <span>History overlays</span>
            </label>
          </div>
        </section>

        <section class="card">
          <div class="card-title-row">
            <h2>Connection State</h2>
            <span class="metric" id="connection-summary">Booting</span>
          </div>
          <div class="status-grid connection-grid">
            <div class="status-item" id="stream-state-card">
              <strong>CoT Stream</strong>
              <div id="stream-state-value">Pending</div>
              <div id="stream-state-note">Waiting for live stream startup.</div>
            </div>
            <div class="status-item" id="lookup-state-card">
              <strong>HTTP Lookup</strong>
              <div id="lookup-state-value">Pending</div>
              <div id="lookup-state-note">Waiting for target lookup.</div>
            </div>
            <div class="status-item" id="replay-connection-card">
              <strong>Replay</strong>
              <div id="replay-connection-value">Idle</div>
              <div id="replay-connection-note">No replay activity yet.</div>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-title-row">
            <h2>2525 / Maritime Legend</h2>
            <span class="metric">Guide</span>
          </div>
          <div class="legend-block">
            <div class="legend-title">Affiliation Frames</div>
            <div class="legend-row">
              <div class="legend-item">
                <span class="legend-frame friend"></span>
                <span>Friend</span>
              </div>
              <div class="legend-item">
                <span class="legend-frame neutral"></span>
                <span>Neutral</span>
              </div>
              <div class="legend-item">
                <span class="legend-frame unknown"></span>
                <span>Unknown</span>
              </div>
              <div class="legend-item">
                <span class="legend-frame hostile"></span>
                <span>Hostile</span>
              </div>
            </div>
          </div>
          <div class="legend-block">
            <div class="legend-title">Maritime Mapping</div>
            <div class="legend-pills">
              <span class="legend-pill">Cargo</span>
              <span class="legend-pill">Tanker</span>
              <span class="legend-pill">Tug</span>
              <span class="legend-pill">Passenger / Ferry</span>
              <span class="legend-pill">Fishing</span>
              <span class="legend-pill">Sailing / Pleasure</span>
              <span class="legend-pill">Law enforcement</span>
              <span class="legend-pill">SAR / Rescue</span>
            </div>
            <p class="legend-copy">
              In <strong>2525-style</strong> mode, replay vessels and TAK-fed replay contacts use these maritime
              categories when type or subtype metadata is available. Otherwise the map falls back to a generic
              sea-surface symbol.
            </p>
            <p class="legend-copy">
              Live replay flowing back from TAK is classified from CoT remarks written by the replay injector.
              Direct live CoT without maritime metadata stays generic.
            </p>
          </div>
        </section>

        <section class="card">
          <div class="card-title-row">
            <h2>TAK Health</h2>
            <span class="metric" id="status-overall">Unknown</span>
          </div>
          <div class="status-grid" id="status-grid"></div>
          <div class="status-note" id="target-lookup-note">Target lookup pending.</div>
        </section>

        <section class="card">
          <div class="card-title-row">
            <h2>TAK Actions</h2>
            <span class="metric" id="query-result-mode">Read only</span>
          </div>
          <label>
            <span>UID or CoT ID</span>
            <input id="query-value" type="text" placeholder="replay-vessel-123 or 4567" />
          </label>
          <div class="button-row">
            <button id="query-uid" type="button">Lookup UID</button>
            <button id="query-cotid" type="button">Lookup CoT ID</button>
          </div>
          <div class="status-note" id="query-result-note">
            Safe TAK queries only. Destructive user/group changes stay in the CLI until browser-side permissions are reviewed.
          </div>
        </section>

        <section class="card">
          <div class="card-title-row">
            <h2>Inject CoT</h2>
            <span class="metric" id="inject-mode">Map Center</span>
          </div>
          <form id="inject-form" class="stack">
            <label>
              <span>UID</span>
              <input id="inject-uid" name="uid" type="text" placeholder="map-ui-alpha" required />
            </label>
            <label>
              <span>Callsign</span>
              <input id="inject-callsign" name="callsign" type="text" placeholder="Falcon 1" />
            </label>
            <div class="field-row">
              <label>
                <span>Type</span>
                <input id="inject-type" name="type" type="text" value="a-f-G-U-C" />
              </label>
              <label>
                <span>How</span>
                <input id="inject-how" name="how" type="text" value="m-g" />
              </label>
            </div>
            <div class="field-row">
              <label>
                <span>Latitude</span>
                <input id="inject-lat" name="lat" type="number" step="any" required />
              </label>
              <label>
                <span>Longitude</span>
                <input id="inject-lon" name="lon" type="number" step="any" required />
              </label>
            </div>
            <label>
              <span>Remarks</span>
              <textarea id="inject-remarks" name="remarks" rows="3" placeholder="Sent from TAKCLI map UI"></textarea>
            </label>
            <div class="button-row">
              <button id="use-map-center" type="button">Use Map Center</button>
              <button id="use-selected-point" type="button">Use Selected Point</button>
              <button id="inject-submit" type="submit" class="button-accent">Inject Event</button>
            </div>
          </form>
        </section>

        <section class="card">
          <div class="card-title-row">
            <h2>Activity</h2>
            <span class="metric" id="event-count">0 events</span>
          </div>
          <ul id="event-feed" class="event-feed"></ul>
        </section>
      </aside>

      <main class="map-stage">
        <div id="map" aria-label="TAK map"></div>
        <div class="map-topbar">
          <div class="map-brand">
            <img src="/takcli-logo.png" alt="" class="takcli-logo" aria-hidden="true" />
            <div class="map-brand-copy">
              <div class="toolbar-label">Map Console</div>
              <h1>TAKCLI</h1>
            </div>
          </div>
          <div class="toolbar-stats">
            <span id="target-count">0 targets</span>
            <span id="target-state">Source pending</span>
            <span id="live-state">Live off</span>
            <button id="toggle-sidebar" type="button" class="panel-toggle" aria-controls="map-sidebar" aria-expanded="true">Hide Sidebar</button>
          </div>
        </div>
        <footer class="powered-footer">
          <span>Powered by</span>
          <img src="/codehaus.png" alt="Codehaus" />
        </footer>
      </main>
    </div>

    <script src="/milsymbol.js"></script>
    <script src="/leaflet.js"></script>
    <script type="module" src="/app.js"></script>
  </body>
</html>`;
}

export const mapAppCss = `
:root {
  color-scheme: dark;
  --bg: #07100f;
  --panel: rgba(9, 17, 16, 0.86);
  --panel-strong: rgba(11, 24, 22, 0.96);
  --line: rgba(142, 255, 212, 0.16);
  --text: #edf7f3;
  --muted: #a9c1b9;
  --accent: #7ee0c3;
  --accent-strong: #f1b768;
  --danger: #ff8e7f;
  --shadow: 0 18px 48px rgba(0, 0, 0, 0.42);
}

* {
  box-sizing: border-box;
}

html,
body {
  height: 100%;
  margin: 0;
}

body {
  background:
    radial-gradient(circle at top left, rgba(142, 255, 212, 0.12), transparent 24rem),
    radial-gradient(circle at bottom right, rgba(241, 183, 104, 0.1), transparent 28rem),
    linear-gradient(180deg, #07100f 0%, #081210 100%);
  color: var(--text);
  font-family: "IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif;
}

button,
input,
textarea,
select {
  font: inherit;
}

button,
input,
textarea,
select {
  border-radius: 14px;
  border: 1px solid rgba(126, 224, 195, 0.18);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
}

button {
  cursor: pointer;
  padding: 0.78rem 1rem;
  transition: transform 120ms ease, border-color 120ms ease, background 120ms ease;
}

button:hover:not(:disabled) {
  border-color: rgba(126, 224, 195, 0.5);
  transform: translateY(-1px);
}

button:disabled,
input:disabled,
select:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

button.button-accent {
  background: linear-gradient(135deg, rgba(126, 224, 195, 0.22), rgba(241, 183, 104, 0.2));
  border-color: rgba(241, 183, 104, 0.5);
}

input,
textarea,
select {
  padding: 0.82rem 0.9rem;
  width: 100%;
}

textarea {
  min-height: 5.8rem;
  resize: vertical;
}

input[type="range"] {
  padding: 0;
}

.shell {
  display: grid;
  grid-template-columns: minmax(21rem, 31rem) 1fr;
  height: 100%;
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.1rem;
  background: linear-gradient(180deg, rgba(5, 15, 14, 0.94), rgba(8, 18, 16, 0.86));
  backdrop-filter: blur(18px);
  border-right: 1px solid var(--line);
  overflow-y: auto;
}

.panel-header,
.card {
  background: linear-gradient(180deg, var(--panel), var(--panel-strong));
  border: 1px solid var(--line);
  border-radius: 22px;
  box-shadow: var(--shadow);
}

.panel-header {
  padding: 1.25rem;
}

.eyebrow,
.toolbar-label,
dt {
  color: var(--accent);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-size: 0.72rem;
}

h1,
h2 {
  font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif;
  margin: 0;
}

h1 {
  margin-top: 0.4rem;
  font-size: 2rem;
  line-height: 1.05;
}

h2 {
  font-size: 1.2rem;
}

.lede,
.toolbar-copy,
.logo-copy {
  color: var(--muted);
  line-height: 1.5;
}

.logo-card {
  margin-top: 1rem;
  display: grid;
  grid-template-columns: 4.4rem 1fr;
  gap: 0.9rem;
  align-items: center;
  padding: 0.9rem;
  border-radius: 18px;
  background: rgba(238, 250, 245, 0.05);
  border: 1px dashed rgba(142, 255, 212, 0.24);
}

.logo-image {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.04);
}

.logo-label {
  font-weight: 700;
  margin-bottom: 0.2rem;
}

.card {
  padding: 1rem;
}

.card-title-row,
.button-row,
.field-row,
.map-topbar,
.map-brand,
.toolbar-stats,
.toggle-row,
.checkbox-row {
  display: flex;
  gap: 0.75rem;
}

.card-title-row,
.map-topbar {
  align-items: center;
  justify-content: space-between;
}

.button-row,
.field-row,
.toolbar-stats,
.toggle-row {
  flex-wrap: wrap;
}

.toolbar-stats {
  align-items: center;
}

.checkbox-row {
  align-items: center;
}

.checkbox-row input {
  width: auto;
  margin: 0;
}

.checkbox-row span {
  color: var(--muted);
  font-size: 0.92rem;
}

.status-pill,
.metric,
.toolbar-stats span {
  padding: 0.38rem 0.7rem;
  border-radius: 999px;
  border: 1px solid rgba(126, 224, 195, 0.22);
  background: rgba(255, 255, 255, 0.05);
  color: var(--muted);
  font-size: 0.88rem;
}

.panel-toggle {
  min-height: 2.15rem;
  padding: 0 0.7rem;
  border-radius: 8px;
  border-color: rgba(142, 255, 212, 0.18);
  background: rgba(238, 250, 245, 0.08);
  color: var(--text);
  font-size: 0.78rem;
}

.meta-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.85rem;
  margin: 1rem 0;
}

.replay-meta-grid {
  margin-bottom: 0.8rem;
}

.replay-telemetry-grid {
  margin-top: 0.85rem;
  margin-bottom: 0.3rem;
}

dd {
  margin: 0.28rem 0 0;
  font-size: 0.96rem;
  word-break: break-word;
}

.status-grid {
  display: grid;
  gap: 0.75rem;
  margin-top: 0.9rem;
}

.connection-grid .status-item div:last-child {
  color: var(--muted);
  font-size: 0.92rem;
  line-height: 1.4;
}

.status-note {
  margin-top: 0.9rem;
  color: var(--muted);
  font-size: 0.9rem;
  line-height: 1.4;
}

.status-item {
  padding: 0.9rem;
  border-radius: 18px;
  border: 1px solid rgba(126, 224, 195, 0.15);
  background: rgba(255, 255, 255, 0.03);
}

.status-item strong,
.event-label {
  display: block;
  margin-bottom: 0.22rem;
}

.status-item.ok {
  border-color: rgba(126, 224, 195, 0.32);
}

.status-item.warn {
  border-color: rgba(241, 183, 104, 0.38);
}

.status-item.fail {
  border-color: rgba(255, 142, 127, 0.38);
}

.stack {
  display: grid;
  gap: 0.8rem;
  margin-top: 0.9rem;
}

label {
  display: grid;
  gap: 0.38rem;
}

label span {
  color: var(--muted);
  font-size: 0.9rem;
}

.range-field {
  margin-bottom: 0.9rem;
}

.event-feed {
  list-style: none;
  padding: 0;
  margin: 0.9rem 0 0;
  display: grid;
  gap: 0.65rem;
}

.event-feed li {
  padding: 0.8rem 0.9rem;
  border-radius: 16px;
  border: 1px solid rgba(126, 224, 195, 0.12);
  background: rgba(255, 255, 255, 0.025);
}

.event-meta {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  flex-wrap: wrap;
  margin-bottom: 0.22rem;
}

.event-meta .event-label {
  margin-bottom: 0;
}

.source-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.18rem 0.5rem;
  border-radius: 999px;
  border: 1px solid rgba(126, 224, 195, 0.2);
  background: rgba(255, 255, 255, 0.045);
  color: var(--muted);
  font-size: 0.73rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.source-badge.ok {
  border-color: rgba(126, 224, 195, 0.38);
  color: var(--accent);
}

.source-badge.warn {
  border-color: rgba(241, 183, 104, 0.4);
  color: var(--accent-strong);
}

.source-badge.fail {
  border-color: rgba(255, 142, 127, 0.4);
  color: var(--danger);
}

.event-copy {
  color: var(--muted);
  font-size: 0.92rem;
  line-height: 1.45;
}

.legend-block + .legend-block {
  margin-top: 1rem;
}

.legend-title {
  color: var(--text);
  font-size: 0.9rem;
  font-weight: 700;
  margin-bottom: 0.65rem;
}

.legend-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem 0.9rem;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  color: var(--muted);
  font-size: 0.9rem;
}

.legend-frame {
  display: inline-block;
  width: 1.35rem;
  height: 1.05rem;
  border: 2px solid currentColor;
  background: rgba(255, 255, 255, 0.03);
}

.legend-frame.friend {
  color: #73b7ff;
  border-radius: 0.5rem;
}

.legend-frame.neutral {
  color: #7ee0c3;
  border-radius: 0.18rem;
}

.legend-frame.unknown {
  color: #f1d36f;
  clip-path: polygon(15% 0, 85% 0, 100% 50%, 85% 100%, 15% 100%, 0 50%);
}

.legend-frame.hostile {
  color: #ff8e7f;
  transform: rotate(45deg);
  border-radius: 0.1rem;
}

.legend-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin-bottom: 0.8rem;
}

.legend-pill {
  display: inline-flex;
  align-items: center;
  padding: 0.28rem 0.58rem;
  border-radius: 999px;
  border: 1px solid rgba(126, 224, 195, 0.18);
  background: rgba(255, 255, 255, 0.04);
  color: var(--muted);
  font-size: 0.82rem;
}

.legend-copy {
  margin: 0.55rem 0 0;
  color: var(--muted);
  font-size: 0.9rem;
  line-height: 1.45;
}

.map-stage {
  position: relative;
  min-height: 0;
  overflow: hidden;
}

.shell.sidebar-hidden {
  grid-template-columns: 1fr;
}

.shell.sidebar-hidden .panel {
  display: none;
}

.map-topbar {
  position: absolute;
  z-index: 500;
  top: 1rem;
  left: 1rem;
  right: 1rem;
  padding: 0.9rem 1rem;
  border-radius: 8px;
  border: 1px solid rgba(142, 255, 212, 0.16);
  background: rgba(9, 17, 16, 0.86);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.42);
  backdrop-filter: blur(16px);
}

.map-brand {
  min-width: 0;
  align-items: center;
}

.takcli-logo {
  width: 5.3rem;
  height: 3.55rem;
  flex: 0 0 auto;
  border-radius: 6px;
  object-fit: cover;
  object-position: center;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.38);
}

.map-brand h1 {
  font-family: "IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif;
  margin-top: 0.12rem;
  font-size: clamp(1.35rem, 2vw, 2rem);
  white-space: nowrap;
}

#map {
  position: absolute;
  inset: 0;
  height: 100%;
}

.leaflet-container {
  background: #0a1721;
}

.leaflet-top {
  top: 6.4rem;
}

.powered-footer {
  position: absolute;
  left: 1rem;
  bottom: 1rem;
  z-index: 500;
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  min-height: 2.2rem;
  padding: 0.28rem 0.5rem;
  border: 1px solid rgba(142, 255, 212, 0.16);
  border-radius: 6px;
  background: rgba(9, 17, 16, 0.86);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.32);
  backdrop-filter: blur(16px);
  color: #94b5aa;
  font-size: 0.72rem;
  font-weight: 800;
  text-transform: uppercase;
}

.powered-footer img {
  display: block;
  width: 84px;
  height: auto;
  max-height: 1.65rem;
}

.leaflet-popup-content-wrapper,
.leaflet-popup-tip {
  background: #122633;
  color: var(--text);
}

@media (max-width: 1100px) {
  .shell {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }

  .shell.sidebar-hidden {
    grid-template-rows: 1fr;
  }

  .panel {
    max-height: 60vh;
  }

  .map-topbar {
    flex-wrap: wrap;
  }
}

@media (max-width: 720px) {
  .map-topbar {
    top: 0.7rem;
    left: 0.7rem;
    right: 0.7rem;
    gap: 0.6rem;
    padding: 0.7rem;
  }

  .takcli-logo {
    width: 3.65rem;
    height: 2.45rem;
  }

  .map-brand {
    gap: 0.45rem;
  }

  .map-brand h1 {
    font-size: 1.08rem;
  }

  .leaflet-top {
    top: 5rem;
  }

  .powered-footer {
    left: 0.6rem;
    bottom: max(0.6rem, env(safe-area-inset-bottom));
    gap: 0.45rem;
    min-height: 1.9rem;
    padding: 0.22rem 0.4rem;
    font-size: 0.62rem;
  }

  .powered-footer img {
    width: 68px;
    max-height: 1.35rem;
  }
}
`;

export const mapAppJs = `
const REPLAY_SPEED_OPTIONS = {
  1: "1x realtime",
  60: "1m / sec",
  600: "10m / sec",
  3600: "1h / sec",
  21600: "6h / sec",
  86400: "1d / sec",
  604800: "1w / sec"
};
const REPLAY_TRAIL_POINTS = 8;
const LIVE_TRACK_MAX_POINTS = 120;
const LIVE_CONTACT_COLORS = ["#f1b768", "#7ee0c3", "#73b7ff", "#d99bff", "#ff9f80", "#87d1ff"];

const state = {
  connectionStates: {
    lookup: {
      mode: "pending",
      note: "Waiting for target lookup.",
      text: "Pending"
    },
    replay: {
      mode: "idle",
      note: "No replay activity yet.",
      text: "Idle"
    },
    stream: {
      mode: "pending",
      note: "Waiting for live stream startup.",
      text: "Pending"
    }
  },
  eventCount: 0,
  eventSource: null,
  lastSelectedPoint: null,
  lastTargets: [],
  layerVisibility: {
    liveMarkers: true,
    liveTracks: true,
    replayHistory: false,
    replayTracks: true
  },
  liveTrackLayer: null,
  liveTracks: new Map(),
  liveMarkers: new Map(),
  liveMarkerLayer: null,
  liveContacts: new Map(),
  map: null,
  markerMode: "dots",
  replay: null,
  replayTelemetryPollId: 0,
  replayPositionLayer: null,
  replayTrailLayer: null,
  replayHistoryLayer: null,
  selectedMarker: null,
  sidebarVisible: true,
  targetMarkers: new Map(),
  targetLayer: null
};

const el = {
  appShell: document.querySelector("#app-shell"),
  eventCount: document.querySelector("#event-count"),
  eventFeed: document.querySelector("#event-feed"),
  injectCallsign: document.querySelector("#inject-callsign"),
  injectForm: document.querySelector("#inject-form"),
  injectHow: document.querySelector("#inject-how"),
  injectLat: document.querySelector("#inject-lat"),
  injectLon: document.querySelector("#inject-lon"),
  injectMode: document.querySelector("#inject-mode"),
  injectRemarks: document.querySelector("#inject-remarks"),
  injectType: document.querySelector("#inject-type"),
  injectUid: document.querySelector("#inject-uid"),
  queryCotId: document.querySelector("#query-cotid"),
  queryResultMode: document.querySelector("#query-result-mode"),
  queryResultNote: document.querySelector("#query-result-note"),
  queryUid: document.querySelector("#query-uid"),
  queryValue: document.querySelector("#query-value"),
  layerLiveMarkers: document.querySelector("#layer-live-markers"),
  layerLiveTracks: document.querySelector("#layer-live-tracks"),
  layerReplayTracks: document.querySelector("#layer-replay-tracks"),
  liveState: document.querySelector("#live-state"),
  connectionSummary: document.querySelector("#connection-summary"),
  lookupStateCard: document.querySelector("#lookup-state-card"),
  lookupStateNote: document.querySelector("#lookup-state-note"),
  lookupStateValue: document.querySelector("#lookup-state-value"),
  markerMode: document.querySelector("#marker-mode"),
  metaCotPort: document.querySelector("#meta-cot-port"),
  metaProfile: document.querySelector("#meta-profile"),
  metaReplay: document.querySelector("#meta-replay"),
  metaServer: document.querySelector("#meta-server"),
  refreshStatus: document.querySelector("#refresh-status"),
  refreshTargets: document.querySelector("#refresh-targets"),
  replayAutoFollow: document.querySelector("#replay-auto-follow"),
  replayFit: document.querySelector("#replay-fit"),
  replayRange: document.querySelector("#replay-range"),
  replayRestart: document.querySelector("#replay-restart"),
  replayScrubber: document.querySelector("#replay-scrubber"),
  replayShowHistory: document.querySelector("#replay-show-history"),
  replayShowTrails: document.querySelector("#replay-show-trails"),
  replayConnectionCard: document.querySelector("#replay-connection-card"),
  replayConnectionNote: document.querySelector("#replay-connection-note"),
  replayConnectionValue: document.querySelector("#replay-connection-value"),
  replayInjectionStatus: document.querySelector("#replay-injection-status"),
  replayInjectSpeed: document.querySelector("#replay-inject-speed"),
  replayLastSourceTime: document.querySelector("#replay-last-source-time"),
  replaySentEvents: document.querySelector("#replay-sent-events"),
  replaySpeed: document.querySelector("#replay-speed"),
  replaySpeedReadout: document.querySelector("#replay-speed-readout"),
  replayState: document.querySelector("#replay-state"),
  replayTime: document.querySelector("#replay-time"),
  replayToggle: document.querySelector("#replay-toggle"),
  replayVisible: document.querySelector("#replay-visible"),
  statusGrid: document.querySelector("#status-grid"),
  statusOverall: document.querySelector("#status-overall"),
  statusPill: document.querySelector("#status-pill"),
  streamStateCard: document.querySelector("#stream-state-card"),
  streamStateNote: document.querySelector("#stream-state-note"),
  streamStateValue: document.querySelector("#stream-state-value"),
  targetCount: document.querySelector("#target-count"),
  targetLookupNote: document.querySelector("#target-lookup-note"),
  targetState: document.querySelector("#target-state"),
  toggleLive: document.querySelector("#toggle-live"),
  toggleSidebar: document.querySelector("#toggle-sidebar"),
  useMapCenter: document.querySelector("#use-map-center"),
  useSelectedPoint: document.querySelector("#use-selected-point")
};

function formatCoordinate(value) {
  return Number.isFinite(value) ? value.toFixed(5) : "-";
}

function formatReplayTime(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return new Date(value).toISOString().replace(".000Z", "Z");
}

function formatReplayRange(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return "-";
  }

  return formatReplayTime(start) + " to " + formatReplayTime(end);
}

function formatReplayTelemetrySpeed(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return REPLAY_SPEED_OPTIONS[value] ?? (value + "x");
}

function resetReplayTelemetryUi() {
  el.replayInjectionStatus.textContent = "Idle";
  el.replaySentEvents.textContent = "0";
  el.replayInjectSpeed.textContent = "-";
  el.replayLastSourceTime.textContent = "-";
}

function setStatusPill(text, mode) {
  el.statusPill.textContent = text;
  el.statusPill.style.borderColor =
    mode === "ok" ? "rgba(126, 224, 195, 0.45)" :
    mode === "warn" ? "rgba(241, 183, 104, 0.55)" :
    "rgba(255, 142, 127, 0.55)";
}

function setTargetLookupState(text, mode, note) {
  el.targetState.textContent = "Source: " + text;
  el.targetState.style.color =
    mode === "ok" ? "var(--accent)" :
    mode === "warn" ? "var(--accent-strong)" :
    "var(--danger)";
  el.targetLookupNote.textContent = note;
}

function connectionModeToClass(mode) {
  if (mode === "ok") {
    return "ok";
  }

  if (mode === "fail") {
    return "fail";
  }

  return "warn";
}

function summarizeConnectionStates() {
  const streamMode = state.connectionStates.stream.mode;
  const lookupMode = state.connectionStates.lookup.mode;
  const replayMode = state.connectionStates.replay.mode;

  if (streamMode === "fail" || lookupMode === "fail" || replayMode === "fail") {
    return "Degraded";
  }

  if (
    streamMode === "warn" ||
    streamMode === "pending" ||
    lookupMode === "warn" ||
    lookupMode === "pending" ||
    replayMode === "pending"
  ) {
    return "Partial";
  }

  return "Ready";
}

function renderConnectionStates() {
  const stream = state.connectionStates.stream;
  const lookup = state.connectionStates.lookup;
  const replay = state.connectionStates.replay;

  el.streamStateCard.classList.remove("ok", "warn", "fail");
  el.streamStateCard.classList.add(connectionModeToClass(stream.mode));
  el.streamStateValue.textContent = stream.text;
  el.streamStateNote.textContent = stream.note;

  el.lookupStateCard.classList.remove("ok", "warn", "fail");
  el.lookupStateCard.classList.add(connectionModeToClass(lookup.mode));
  el.lookupStateValue.textContent = lookup.text;
  el.lookupStateNote.textContent = lookup.note;

  el.replayConnectionCard.classList.remove("ok", "warn", "fail");
  el.replayConnectionCard.classList.add(connectionModeToClass(replay.mode));
  el.replayConnectionValue.textContent = replay.text;
  el.replayConnectionNote.textContent = replay.note;

  el.connectionSummary.textContent = summarizeConnectionStates();
}

function setStreamConnectionState(text, mode, note) {
  state.connectionStates.stream = { mode, note, text };
  renderConnectionStates();
}

function setLookupConnectionState(text, mode, note) {
  state.connectionStates.lookup = { mode, note, text };
  renderConnectionStates();
}

function setReplayConnectionState(text, mode, note) {
  state.connectionStates.replay = { mode, note, text };
  renderConnectionStates();
}

function isReplayLikeEvent(event) {
  return String(event.uid ?? "").startsWith("replay-vessel-") ||
    String(event.remarks ?? "").includes("Source: replay file");
}

function describeLiveEventProvenance(event) {
  if (isReplayLikeEvent(event)) {
    return {
      badge: "Replay via TAK",
      note: "Replay-fed CoT arriving from the TAK live stream.",
      popupLabel: "Replay via TAK live stream",
      tone: "warn"
    };
  }

  return {
    badge: "Live CoT",
    note: "Observed on the TAK live CoT stream.",
    popupLabel: "Live TAK CoT stream",
    tone: "ok"
  };
}

function describeTargetProvenance(target, lookupSource) {
  if (lookupSource === "tak") {
    return {
      badge: "TAK Lookup",
      popupLabel: "TAK HTTPS target lookup",
      tone: "ok"
    };
  }

  if (lookupSource === "live-cache") {
    if (String(target.uid ?? "").startsWith("replay-vessel-")) {
      return {
        badge: "Replay via TAK",
        popupLabel: "Replay-fed live CoT cached by the map",
        tone: "warn"
      };
    }

    return {
      badge: "Live CoT Cache",
      popupLabel: "Recent live CoT cached by the map",
      tone: "warn"
    };
  }

  return {
    badge: "Unavailable",
    popupLabel: "Target source unavailable",
    tone: "fail"
  };
}

function pushEvent(label, copy, options = {}) {
  state.eventCount += 1;
  el.eventCount.textContent = state.eventCount + " events";

  const item = document.createElement("li");
  const meta = document.createElement("div");
  const badge = document.createElement("span");
  const title = document.createElement("strong");
  const body = document.createElement("div");
  meta.className = "event-meta";
  badge.className = "source-badge " + (options.sourceTone ?? "neutral");
  badge.textContent = options.sourceLabel ?? "System";
  title.className = "event-label";
  title.textContent = label;
  body.className = "event-copy";
  body.textContent = copy;
  meta.append(badge, title);
  item.append(meta, body);
  el.eventFeed.prepend(item);

  while (el.eventFeed.children.length > 14) {
    el.eventFeed.removeChild(el.eventFeed.lastElementChild);
  }
}

function setSidebarVisible(visible) {
  state.sidebarVisible = visible;
  el.appShell.classList.toggle("sidebar-hidden", !visible);
  el.toggleSidebar.textContent = visible ? "Hide Sidebar" : "Show Sidebar";
  el.toggleSidebar.setAttribute("aria-expanded", visible ? "true" : "false");

  window.setTimeout(() => {
    state.map?.invalidateSize();
  }, 180);
}

function toggleSidebar() {
  setSidebarVisible(!state.sidebarVisible);
  pushEvent(
    "Sidebar " + (state.sidebarVisible ? "shown" : "hidden"),
    state.sidebarVisible ? "The map control sidebar is visible." : "The map has expanded to use the sidebar space.",
    {
      sourceLabel: "System",
      sourceTone: "neutral"
    }
  );
}

function updateInjectFields(lat, lon, modeLabel) {
  el.injectLat.value = String(lat);
  el.injectLon.value = String(lon);
  el.injectMode.textContent = modeLabel;
}

function ensureUidDefault() {
  if (el.injectUid.value.trim().length > 0) {
    return;
  }

  el.injectUid.value = "map-ui-" + Math.random().toString(36).slice(2, 8);
}

function createMarkerHtml(fill) {
  return '<svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<circle cx="13" cy="13" r="11" fill="' + fill + '" fill-opacity="0.18" stroke="' + fill + '" stroke-width="2" />' +
    '<circle cx="13" cy="13" r="4" fill="' + fill + '" />' +
    '</svg>';
}

function getStableColorForUid(uid) {
  const source = String(uid ?? "");
  let hash = 0;

  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) - hash + source.charCodeAt(index)) | 0;
  }

  return LIVE_CONTACT_COLORS[Math.abs(hash) % LIVE_CONTACT_COLORS.length];
}

function inferAffiliation(cotType, fallbackAffiliation = "unknown") {
  const upper = String(cotType ?? "").toUpperCase();
  if (upper.includes("-F-")) {
    return "friend";
  }
  if (upper.includes("-H-")) {
    return "hostile";
  }
  if (upper.includes("-N-")) {
    return "neutral";
  }
  if (upper.includes("-U-")) {
    return "unknown";
  }
  return fallbackAffiliation;
}

function inferDimension(cotType, fallbackDimension = "unknown") {
  const upper = String(cotType ?? "").toUpperCase();
  if (upper.includes("-S-")) {
    return "surface";
  }
  if (upper.includes("-U-")) {
    return "subsurface";
  }
  if (upper.includes("-G-")) {
    return "ground";
  }
  if (upper.includes("-A-")) {
    return "air";
  }
  if (upper.includes("-P-")) {
    return "space";
  }
  return fallbackDimension;
}

function parseRemarksMetadata(remarks) {
  if (!remarks) {
    return {};
  }

  const metadata = {};
  for (const part of String(remarks).split("|")) {
    const trimmed = part.trim();
    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim().toLowerCase();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (value.length === 0) {
      continue;
    }

    metadata[key] = value;
  }

  return metadata;
}

function getReplaySourceTime(remarks) {
  return parseRemarksMetadata(remarks)["source time"];
}

function buildVesselMetadataHtml(remarks) {
  const metadata = parseRemarksMetadata(remarks);
  const lines = [];

  if (metadata.type) {
    lines.push("Vessel type: " + metadata.type);
  }

  if (metadata.subtype) {
    lines.push("Subtype: " + metadata.subtype);
  }

  if (metadata["craft id"]) {
    lines.push("Craft ID: " + metadata["craft id"]);
  }

  if (metadata.length || metadata.beam || metadata.draught) {
    lines.push(
      "Dimensions: " +
      [
        metadata.length ? "L " + metadata.length : undefined,
        metadata.beam ? "B " + metadata.beam : undefined,
        metadata.draught ? "D " + metadata.draught : undefined
      ].filter(Boolean).join(" / ")
    );
  }

  return lines.length > 0 ? lines.join("<br />") + "<br />" : "";
}

function getReplaySourceTimeMs(remarks) {
  const sourceTime = getReplaySourceTime(remarks);
  if (!sourceTime) {
    return undefined;
  }

  const parsed = Date.parse(sourceTime);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function buildReplayTimingHtml(sourceTime, displayTime, displayLabel) {
  if (!sourceTime) {
    return displayTime ? displayLabel + ": " + displayTime : "";
  }

  const displayValue = displayTime ?? "-";
  return "Source Time: " + sourceTime + "<br />" + displayLabel + ": " + displayValue;
}

function buildReplayTimingCopy(sourceTime, displayTime, displayLabel) {
  if (!sourceTime) {
    return displayTime ? displayLabel + " " + displayTime + "." : "";
  }

  return " Source time " + sourceTime + "; " + displayLabel + " " + (displayTime ?? "-") + ".";
}

function normalizeMaritimeLabel(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\\s+/g, " ")
    .trim();
}

function inferSeaFunctionId(options) {
  const typeLabel = normalizeMaritimeLabel(options.maritimeType);
  const subtypeLabel = normalizeMaritimeLabel(options.maritimeSubtype);
  const combined = [subtypeLabel, typeLabel].filter(Boolean).join(" ");

  if (!combined) {
    return undefined;
  }

  if (combined.includes("law enforcement")) {
    return "XL----";
  }

  if (combined.includes("fishing")) {
    if (combined.includes("trawler")) {
      return "XFTR--";
    }

    if (combined.includes("drifter")) {
      return "XFDF--";
    }

    return "XF----";
  }

  if (combined.includes("sailing")) {
    return "XR----";
  }

  if (combined.includes("pleasure craft") || combined.includes("leisure") || combined.includes("yacht")) {
    if (combined.includes("speedboat")) {
      return "XAS---";
    }

    if (combined.includes("rigid-hull inflatable")) {
      return "XAR---";
    }

    return "XA----";
  }

  if (combined.includes("cargo")) {
    return "XMC---";
  }

  if (combined.includes("tanker") || combined.includes("oiler")) {
    return "XMO---";
  }

  if (combined.includes("passenger")) {
    if (combined.includes("ferry")) {
      return "XMF---";
    }

    return "XMP---";
  }

  if (combined.includes("ferry")) {
    return "XMF---";
  }

  if (combined.includes("tug") || combined.includes("tow")) {
    return "XMT---";
  }

  if (combined.includes("pilot vessel") || combined.includes("port tender") || combined.includes("diving")) {
    return "NS----";
  }

  if (combined.includes("sar") || combined.includes("search and rescue") || combined.includes("rescue")) {
    return "CP----";
  }

  if (combined.includes("hsc") || combined.includes("high speed craft")) {
    return "XMF---";
  }

  if (combined.includes("other")) {
    return "XM----";
  }

  return undefined;
}

function getAffiliationPalette(affiliation) {
  switch (affiliation) {
    case "friend":
      return { fill: "#153247", stroke: "#73b7ff" };
    case "hostile":
      return { fill: "#3f1e1d", stroke: "#ff8e7f" };
    case "neutral":
      return { fill: "#14352f", stroke: "#7ee0c3" };
    default:
      return { fill: "#3d341a", stroke: "#f1d36f" };
  }
}

function build2525Frame(affiliation, stroke, fill) {
  if (affiliation === "hostile") {
    return '<path d="M18 3L33 18L18 33L3 18Z" fill="' + fill + '" stroke="' + stroke + '" stroke-width="2.4"/>';
  }

  if (affiliation === "neutral") {
    return '<rect x="4" y="4" width="28" height="28" rx="2" fill="' + fill + '" stroke="' + stroke + '" stroke-width="2.4"/>';
  }

  if (affiliation === "friend") {
    return '<rect x="4" y="7" width="28" height="22" rx="7" fill="' + fill + '" stroke="' + stroke + '" stroke-width="2.4"/>';
  }

  return '<path d="M8 6H28L32 18L28 30H8L4 18Z" fill="' + fill + '" stroke="' + stroke + '" stroke-width="2.4"/>';
}

function build2525Glyph(dimension, accentColor) {
  if (dimension === "air") {
    return '<path d="M18 11L24 24H12L18 11Z" fill="none" stroke="' + accentColor + '" stroke-width="2.4" stroke-linejoin="round"/>';
  }

  if (dimension === "ground") {
    return '<rect x="12" y="12" width="12" height="12" rx="1.5" fill="none" stroke="' + accentColor + '" stroke-width="2.4"/>';
  }

  if (dimension === "space") {
    return '<circle cx="18" cy="18" r="5.5" fill="none" stroke="' + accentColor + '" stroke-width="2.2"/><path d="M9 18H27M18 9V27" stroke="' + accentColor + '" stroke-width="1.8" stroke-linecap="round"/>';
  }

  if (dimension === "surface") {
    return '<path d="M10 20C11.8 17.8 13.6 17.8 15.4 20C17.2 22.2 19 22.2 20.8 20C22.6 17.8 24.4 17.8 26.2 20" fill="none" stroke="' + accentColor + '" stroke-width="2.3" stroke-linecap="round"/>';
  }

  if (dimension === "subsurface") {
    return '<path d="M10 15C12.4 17.3 14.9 18.5 18 18.5C21.1 18.5 23.6 17.3 26 15" fill="none" stroke="' + accentColor + '" stroke-width="2.3" stroke-linecap="round"/><path d="M18 18.5V25" stroke="' + accentColor + '" stroke-width="2.1" stroke-linecap="round"/>';
  }

  return '<circle cx="18" cy="18" r="4" fill="' + accentColor + '"/>';
}

function getMilsymbolLibrary() {
  return globalThis.ms;
}

function getAffiliationSidcCode(affiliation) {
  switch (affiliation) {
    case "friend":
      return "F";
    case "hostile":
      return "H";
    case "neutral":
      return "N";
    default:
      return "U";
  }
}

function getDimensionSidcCode(dimension) {
  switch (dimension) {
    case "air":
      return "A";
    case "ground":
      return "G";
    case "surface":
      return "S";
    case "subsurface":
      return "U";
    default:
      return "G";
  }
}

function buildSeaSurfaceSidc(affiliationCode, functionId) {
  return "S" + affiliationCode + "SP" + functionId + "-----";
}

function inferSubsurfaceFunctionId(options) {
  const typeLabel = normalizeMaritimeLabel(options.maritimeType);
  const subtypeLabel = normalizeMaritimeLabel(options.maritimeSubtype);
  const combined = [subtypeLabel, typeLabel].filter(Boolean).join(" ");

  if (combined.includes("sensor")) {
    return "E-----";
  }

  if (combined.includes("seabed") || combined.includes("installation")) {
    return "NBS---";
  }

  return undefined;
}

function buildSubsurfaceSidc(affiliationCode, functionId) {
  return "S" + affiliationCode + "UP" + functionId + "-----";
}

function buildMilsymbolSidc(options) {
  const affiliation = inferAffiliation(options.cotType, options.affiliation ?? "unknown");
  const dimension = inferDimension(options.cotType, options.fallbackDimension ?? "ground");
  const remarksMetadata = parseRemarksMetadata(options.remarks);
  const maritimeType = options.maritimeType ?? remarksMetadata.type;
  const maritimeSubtype = options.maritimeSubtype ?? remarksMetadata.subtype;
  const affiliationCode = getAffiliationSidcCode(affiliation);
  if (dimension === "surface") {
    const functionId = inferSeaFunctionId({
      maritimeSubtype,
      maritimeType
    });
    if (functionId) {
      return buildSeaSurfaceSidc(affiliationCode, functionId);
    }
  }

  if (dimension === "subsurface") {
    const functionId = inferSubsurfaceFunctionId({
      maritimeSubtype,
      maritimeType
    });
    if (functionId) {
      return buildSubsurfaceSidc(affiliationCode, functionId);
    }
  }

  return "S" + affiliationCode + getDimensionSidcCode(dimension) + "P-----------";
}

function buildMilsymbolIcon(options) {
  const ms = getMilsymbolLibrary();
  if (!ms || typeof ms.Symbol !== "function") {
    return null;
  }

  try {
    const symbol = new ms.Symbol(buildMilsymbolSidc(options), {
      fill: true,
      frame: true,
      infoFields: false,
      size: options.size ?? 28,
      standard: "2525e",
      uniqueDesignation: options.label
    });
    const anchor = symbol.getAnchor();
    const size = symbol.getSize();

    return L.divIcon({
      className: "",
      html: symbol.asSVG(),
      iconAnchor: [anchor.x, anchor.y],
      iconSize: [size.width, size.height]
    });
  } catch (error) {
    console.warn("Failed to build milsymbol icon", error);
    return null;
  }
}

function create2525MarkerHtml(options) {
  const affiliation = inferAffiliation(options.cotType);
  const dimension = inferDimension(options.cotType, options.fallbackDimension ?? "unknown");
  const palette = getAffiliationPalette(affiliation);

  return '<svg width="32" height="32" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    build2525Frame(affiliation, palette.stroke, palette.fill) +
    build2525Glyph(dimension, options.accentColor ?? palette.stroke) +
    '</svg>';
}

function buildDivIcon(fill) {
  return L.divIcon({
    className: "",
    html: createMarkerHtml(fill),
    iconAnchor: [13, 13],
    iconSize: [26, 26]
  });
}

function buildMarkerIcon(options) {
  if ((options.mode ?? state.markerMode) === "2525") {
    const milsymbolIcon = buildMilsymbolIcon(options);
    if (milsymbolIcon) {
      return milsymbolIcon;
    }

    return L.divIcon({
      className: "",
      html: create2525MarkerHtml(options),
      iconAnchor: [16, 16],
      iconSize: [32, 32]
    });
  }

  return buildDivIcon(options.accentColor ?? "#73b7ff");
}

function setSelectedPoint(latlng) {
  state.lastSelectedPoint = latlng;
  updateInjectFields(latlng.lat, latlng.lng, "Selected Point");

  if (!state.selectedMarker) {
    state.selectedMarker = L.marker(latlng, {
      icon: buildDivIcon("#f1b768"),
      zIndexOffset: 500
    }).addTo(state.map);
  } else {
    state.selectedMarker.setLatLng(latlng);
  }
}

function renderStatus(summary) {
  const overall = summary.overall ?? "unknown";
  el.statusOverall.textContent = overall.toUpperCase();
  setStatusPill(
    overall === "healthy" ? "TAK Healthy" : overall === "degraded" ? "TAK Degraded" : "TAK Unreachable",
    overall === "healthy" ? "ok" : overall === "degraded" ? "warn" : "fail"
  );

  el.statusGrid.innerHTML = "";
  for (const endpoint of summary.endpoints ?? []) {
    const card = document.createElement("div");
    const tcpOk = Boolean(endpoint.tcp?.ok);
    const httpOk = endpoint.http ? Boolean(endpoint.http.ok) : tcpOk;
    const tlsOk = endpoint.tls ? Boolean(endpoint.tls.ok) : true;
    const mode = tcpOk && httpOk && tlsOk ? "ok" : tcpOk ? "warn" : "fail";
    card.className = "status-item " + mode;
    card.innerHTML =
      "<strong>" + endpoint.name.toUpperCase() + "</strong>" +
      "<div>Port " + endpoint.port + "</div>" +
      "<div>TCP: " + (tcpOk ? "OK" : endpoint.tcp?.error ?? "FAIL") + "</div>" +
      (endpoint.tls ? "<div>TLS: " + (tlsOk ? "OK" : endpoint.tls.error ?? "FAIL") + "</div>" : "") +
      (endpoint.http ? "<div>HTTP: " + (httpOk ? endpoint.http.statusCode ?? "OK" : endpoint.http.error ?? "FAIL") + "</div>" : "");
    el.statusGrid.append(card);
  }
}

function renderTargets(result) {
  const bounds = [];
  state.lastTargets = result.targets ?? [];
  const lookupSource = result.lookup?.source ?? "tak";
  const lookupMessage = result.lookup?.message;

  state.targetLayer.clearLayers();
  state.targetMarkers.clear();

  for (const target of state.lastTargets) {
    if (!Number.isFinite(target.lat) || !Number.isFinite(target.lon)) {
      continue;
    }

    const latlng = L.latLng(target.lat, target.lon);
    const provenance = describeTargetProvenance(target, lookupSource);
    const replaySourceTime = getReplaySourceTime(target.remarks);
    const vesselMetadataHtml = buildVesselMetadataHtml(target.remarks);
    const timingHtml = buildReplayTimingHtml(replaySourceTime, target.time, "TAK Event Time");
    bounds.push(latlng);
    const marker = L.marker(latlng, {
      icon: buildMarkerIcon({
        accentColor: "#7ee0c3",
        affiliation: "unknown",
        cotType: target.type,
        fallbackDimension: "surface",
        label: target.callsign ?? target.uid,
        remarks: target.remarks
      })
    });
    marker.bindPopup(
      "<strong>" + (target.callsign ?? target.uid) + "</strong><br />" +
      (target.type ?? "-") + "<br />" +
      vesselMetadataHtml +
      formatCoordinate(target.lat) + ", " + formatCoordinate(target.lon) + "<br />" +
      timingHtml + "<br />" +
      "Source: " + provenance.popupLabel
    );
    marker.addTo(state.targetLayer);
    state.targetMarkers.set(target.uid, {
      marker,
      target
    });
  }

  el.targetCount.textContent = (result.targets?.length ?? 0) + " targets";

  if (lookupSource === "tak") {
    setTargetLookupState("TAK lookup", "ok", "Recent targets are coming from the TAK HTTPS lookup endpoint.");
    setLookupConnectionState("Healthy", "ok", "HTTP target lookup is succeeding against TAK.");
    pushEvent("Targets refreshed", "Loaded " + (result.targets?.length ?? 0) + " recent targets from TAK.", {
      sourceLabel: "TAK Lookup",
      sourceTone: "ok"
    });
  } else if (lookupSource === "live-cache") {
    setTargetLookupState(
      "Live CoT cache",
      "warn",
      "TAK target lookup is degraded, so the map is using recent live CoT contacts instead."
    );
    setLookupConnectionState(
      "Fallback",
      "warn",
      "HTTP lookup is degraded, so the map is using recent live CoT contacts."
    );
    pushEvent(
      "Targets fallback",
      lookupMessage
        ? "Using the live CoT cache because TAK lookup failed: " + lookupMessage
        : "Using the live CoT cache because the TAK target lookup was unavailable.",
      {
        sourceLabel: "Live CoT Cache",
        sourceTone: "warn"
      }
    );
  } else {
    setTargetLookupState(
      "Lookup unavailable",
      "fail",
      lookupMessage
        ? "TAK target lookup is unavailable: " + lookupMessage
        : "TAK target lookup is unavailable and there is no live cache yet."
    );
    setLookupConnectionState(
      "Unavailable",
      "fail",
      lookupMessage ?? "HTTP target lookup is unavailable and there is no live cache yet."
    );
    pushEvent(
      "Targets unavailable",
      lookupMessage ?? "TAK target lookup is unavailable and there is no live cache yet.",
      {
        sourceLabel: "Lookup",
        sourceTone: "fail"
      }
    );
  }

  if (bounds.length > 0) {
    state.map.fitBounds(L.latLngBounds(bounds), { padding: [34, 34] });
  }
}

function upsertLiveMarker(event) {
  const liveContact = state.liveContacts.get(event.uid);
  const marker = liveContact?.marker;
  const accentColor = liveContact?.color ?? getStableColorForUid(event.uid);
  const latlng = L.latLng(event.point.lat, event.point.lon);
  const provenance = describeLiveEventProvenance(event);
  const replaySourceTime = getReplaySourceTime(event.remarks);
  const vesselMetadataHtml = buildVesselMetadataHtml(event.remarks);
  const timingHtml = buildReplayTimingHtml(replaySourceTime, event.time ?? event.start, "TAK Event Time");
  const popup =
    "<strong>" + (event.callsign ?? event.uid) + "</strong><br />" +
    (event.type ?? "-") + "<br />" +
    vesselMetadataHtml +
    formatCoordinate(event.point.lat) + ", " + formatCoordinate(event.point.lon) + "<br />" +
    timingHtml + "<br />" +
    "Source: " + provenance.popupLabel;

  if (marker) {
    marker.setLatLng(latlng);
    marker.setPopupContent(popup);
    marker.setIcon(buildMarkerIcon({
      accentColor,
      affiliation: "unknown",
      cotType: event.type,
      fallbackDimension: "ground",
      label: event.callsign ?? event.uid,
      remarks: event.remarks
    }));
    state.liveContacts.set(event.uid, {
      color: accentColor,
      event,
      marker
    });
    return;
  }

  const created = L.marker(latlng, {
    icon: buildMarkerIcon({
      accentColor,
      affiliation: "unknown",
      cotType: event.type,
      fallbackDimension: "ground",
      label: event.callsign ?? event.uid,
      remarks: event.remarks
    })
  });
  created.bindPopup(popup);
  created.addTo(state.liveMarkerLayer);
  state.liveMarkers.set(event.uid, created);
  state.liveContacts.set(event.uid, {
    color: accentColor,
    event,
    marker: created
  });
}

function upsertLiveTrack(event) {
  const latlng = L.latLng(event.point.lat, event.point.lon);
  const existing = state.liveTracks.get(event.uid);
  const color = existing?.color ?? state.liveContacts.get(event.uid)?.color ?? getStableColorForUid(event.uid);
  const replaySourceTimeMs = getReplaySourceTimeMs(event.remarks);

  if (existing) {
    const loopedReplay =
      replaySourceTimeMs !== undefined &&
      existing.lastReplaySourceTimeMs !== undefined &&
      replaySourceTimeMs + 1000 < existing.lastReplaySourceTimeMs;
    const nextPoints = loopedReplay ? [latlng] : [...existing.points, latlng];
    if (nextPoints.length > LIVE_TRACK_MAX_POINTS) {
      nextPoints.splice(0, nextPoints.length - LIVE_TRACK_MAX_POINTS);
    }

    existing.lastReplaySourceTimeMs = replaySourceTimeMs ?? existing.lastReplaySourceTimeMs;
    existing.points = nextPoints;
    existing.polyline.setLatLngs(nextPoints);
    return;
  }

  const polyline = L.polyline([latlng], {
    color,
    opacity: 0.68,
    weight: 2.5
  }).addTo(state.liveTrackLayer);

  state.liveTracks.set(event.uid, {
    color,
    lastReplaySourceTimeMs: replaySourceTimeMs,
    points: [latlng],
    polyline
  });
}

function rerenderTargetMarkerIcons() {
  for (const entry of state.targetMarkers.values()) {
    entry.marker.setIcon(
      buildMarkerIcon({
        accentColor: "#7ee0c3",
        affiliation: "unknown",
        cotType: entry.target.type,
        fallbackDimension: "surface",
        remarks: entry.target.remarks
      })
    );
  }
}

function rerenderLiveMarkerIcons() {
  for (const entry of state.liveContacts.values()) {
    entry.marker.setIcon(
      buildMarkerIcon({
        accentColor: entry.color ?? getStableColorForUid(entry.event.uid),
        affiliation: "unknown",
        cotType: entry.event.type,
        fallbackDimension: "ground",
        label: entry.event.callsign ?? entry.event.uid,
        remarks: entry.event.remarks
      })
    );
  }
}

function setReplayControlsEnabled(enabled) {
  el.replayToggle.disabled = !enabled;
  el.replayRestart.disabled = !enabled;
  el.replayFit.disabled = !enabled;
  el.replayScrubber.disabled = !enabled;
  el.replaySpeed.disabled = !enabled;
  el.replayShowHistory.disabled = !enabled;
  el.replayShowTrails.disabled = !enabled;
  el.replayAutoFollow.disabled = !enabled;
}

function createReplayBounds(summary) {
  if (!summary.bounds) {
    return null;
  }

  return L.latLngBounds(
    [summary.bounds.minLat, summary.bounds.minLon],
    [summary.bounds.maxLat, summary.bounds.maxLon]
  );
}

function buildReplayPopup(vessel, trackPoint, latlng, playheadMs) {
  const typeLine = trackPoint.type ? trackPoint.type + "<br />" : "";
  const subtypeLine = trackPoint.subtype ? "Subtype: " + trackPoint.subtype + "<br />" : "";
  const craftLine = trackPoint.craftId ? "Craft ID: " + trackPoint.craftId + "<br />" : "";
  const timingHtml = buildReplayTimingHtml(trackPoint.sourceTime, formatReplayTime(playheadMs), "Overlay Time");
  return (
    "<strong>" + (vessel.callsign ?? vessel.uid) + "</strong><br />" +
    "Replay track<br />" +
    typeLine +
    subtypeLine +
    craftLine +
    formatCoordinate(latlng.lat) + ", " + formatCoordinate(latlng.lng) + "<br />" +
    timingHtml
  );
}

function lowerBoundByTime(trackPoints, targetMs) {
  let low = 0;
  let high = trackPoints.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (trackPoints[middle].sourceTimeMs < targetMs) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

function upperBoundByTime(trackPoints, targetMs) {
  let low = 0;
  let high = trackPoints.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (trackPoints[middle].sourceTimeMs <= targetMs) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

function interpolateReplayPoint(previousPoint, nextPoint, playheadMs) {
  if (!nextPoint || nextPoint.sourceTimeMs <= previousPoint.sourceTimeMs) {
    return L.latLng(previousPoint.lat, previousPoint.lon);
  }

  const progress = Math.max(
    0,
    Math.min(1, (playheadMs - previousPoint.sourceTimeMs) / (nextPoint.sourceTimeMs - previousPoint.sourceTimeMs))
  );

  return L.latLng(
    previousPoint.lat + (nextPoint.lat - previousPoint.lat) * progress,
    previousPoint.lon + (nextPoint.lon - previousPoint.lon) * progress
  );
}

function buildTrailLatLngs(trackPoints, lastIndex, currentLatLng) {
  const startIndex = Math.max(0, lastIndex - (REPLAY_TRAIL_POINTS - 1));
  const latLngs = [];

  for (let index = startIndex; index <= lastIndex; index += 1) {
    latLngs.push([trackPoints[index].lat, trackPoints[index].lon]);
  }

  if (
    latLngs.length === 0 ||
    latLngs[latLngs.length - 1][0] !== currentLatLng.lat ||
    latLngs[latLngs.length - 1][1] !== currentLatLng.lng
  ) {
    latLngs.push([currentLatLng.lat, currentLatLng.lng]);
  }

  return latLngs;
}

function updateReplayUi() {
  if (!state.replay) {
    el.replayState.textContent = "No replay";
    el.replayTime.textContent = "-";
    el.replayVisible.textContent = "0 vessels";
    el.replaySpeedReadout.textContent = "-";
    el.replayRange.textContent = "-";
    setReplayConnectionState("Idle", "warn", "No local replay overlay is loaded.");
    return;
  }

  const replay = state.replay;
  const duration = Math.max(1, replay.endTimeMs - replay.startTimeMs);
  const progress = Math.round(((replay.playheadMs - replay.startTimeMs) / duration) * 1000);

  el.replayState.textContent = replay.playing ? "Playing" : "Paused";
  el.replayTime.textContent = formatReplayTime(replay.playheadMs);
  el.replayVisible.textContent = replay.visibleCount + " vessels";
  el.replaySpeedReadout.textContent = REPLAY_SPEED_OPTIONS[replay.speed] ?? (replay.speed + "x");
  el.replayRange.textContent = formatReplayRange(replay.startTimeMs, replay.endTimeMs);
  el.replayScrubber.value = String(Math.max(0, Math.min(1000, progress)));
  el.replayToggle.textContent = replay.playing ? "Pause" : "Play";
  setReplayConnectionState(
    replay.playing ? "Overlay playing" : "Overlay paused",
    "ok",
    "Local replay overlay is " + (replay.playing ? "animating." : "loaded and ready.")
  );
}

function removeReplayVisual(vesselState) {
  if (vesselState.marker) {
    state.replayPositionLayer.removeLayer(vesselState.marker);
    vesselState.marker = null;
  }

  if (vesselState.trail) {
    state.replayTrailLayer.removeLayer(vesselState.trail);
    vesselState.trail = null;
  }
}

function renderReplayFrame(playheadMs) {
  if (!state.replay) {
    return;
  }

  const replay = state.replay;
  replay.visibleCount = 0;
  const followLatLngs = [];

  for (const vessel of replay.vessels) {
    const trackPoints = vessel.trackPoints;
    const upperIndex = upperBoundByTime(trackPoints, playheadMs);
    const lastIndex = upperIndex - 1;
    const vesselState = replay.vesselStates.get(vessel.uid);

    if (lastIndex < 0) {
      removeReplayVisual(vesselState);
      continue;
    }

    const previousPoint = trackPoints[lastIndex];
    const nextPoint = trackPoints[upperIndex];
    const latlng = interpolateReplayPoint(previousPoint, nextPoint, playheadMs);

    if (!vesselState.marker) {
      vesselState.marker = L.marker(latlng, {
        icon: buildMarkerIcon({
          accentColor: vessel.lineColor,
          affiliation: "neutral",
          maritimeSubtype: previousPoint.subtype,
          maritimeType: previousPoint.type,
          label: vessel.callsign ?? vessel.uid,
          fallbackDimension: "surface"
        }),
        zIndexOffset: 200
      }).addTo(state.replayPositionLayer);
      vesselState.markerMode = state.markerMode;
    } else {
      vesselState.marker.setLatLng(latlng);
      if (vesselState.markerMode !== state.markerMode) {
        vesselState.marker.setIcon(
          buildMarkerIcon({
            accentColor: vessel.lineColor,
            affiliation: "neutral",
            maritimeSubtype: previousPoint.subtype,
            maritimeType: previousPoint.type,
            label: vessel.callsign ?? vessel.uid,
            fallbackDimension: "surface"
          })
        );
        vesselState.markerMode = state.markerMode;
      }
    }

    vesselState.marker.setPopupContent(buildReplayPopup(vessel, previousPoint, latlng, playheadMs));

    if (replay.showTrails) {
      const trailLatLngs = buildTrailLatLngs(trackPoints, lastIndex, latlng);
      if (!vesselState.trail) {
        vesselState.trail = L.polyline(trailLatLngs, {
          color: vessel.lineColor,
          opacity: 0.72,
          weight: 3
        }).addTo(state.replayTrailLayer);
      } else {
        vesselState.trail.setLatLngs(trailLatLngs);
      }
    } else if (vesselState.trail) {
      state.replayTrailLayer.removeLayer(vesselState.trail);
      vesselState.trail = null;
    }

    replay.visibleCount += 1;
    followLatLngs.push(latlng);
  }

  if (replay.autoFollow && followLatLngs.length > 0) {
    state.map.panTo(followLatLngs[followLatLngs.length - 1], {
      animate: false
    });
  }

  updateReplayUi();
}

function setReplayPlayhead(playheadMs) {
  if (!state.replay) {
    return;
  }

  const replay = state.replay;
  replay.playheadMs = Math.max(replay.startTimeMs, Math.min(replay.endTimeMs, playheadMs));
  renderReplayFrame(replay.playheadMs);
}

function stopReplayLoop() {
  if (!state.replay || !state.replay.rafId) {
    return;
  }

  cancelAnimationFrame(state.replay.rafId);
  state.replay.rafId = 0;
}

function replayTick(frameTime) {
  if (!state.replay || !state.replay.playing) {
    return;
  }

  const replay = state.replay;
  if (replay.lastFrameTime === 0) {
    replay.lastFrameTime = frameTime;
  }

  const deltaMs = frameTime - replay.lastFrameTime;
  replay.lastFrameTime = frameTime;
  replay.playheadMs = Math.min(replay.endTimeMs, replay.playheadMs + deltaMs * replay.speed);
  renderReplayFrame(replay.playheadMs);

  if (replay.playheadMs >= replay.endTimeMs) {
    replay.playing = false;
    replay.lastFrameTime = 0;
    replay.rafId = 0;
    updateReplayUi();
    setReplayConnectionState("Overlay complete", "warn", "Local replay overlay reached the end of its dataset.");
    pushEvent("Replay complete", "Reached the end of the replay dataset.", {
      sourceLabel: "Replay Overlay",
      sourceTone: "warn"
    });
    return;
  }

  replay.rafId = requestAnimationFrame(replayTick);
}

function startReplayPlayback() {
  if (!state.replay || state.replay.playing) {
    return;
  }

  state.replay.playing = true;
  state.replay.lastFrameTime = 0;
  updateReplayUi();
  pushEvent("Replay started", "Animating current vessel positions from the replay dataset.", {
    sourceLabel: "Replay Overlay",
    sourceTone: "warn"
  });
  state.replay.rafId = requestAnimationFrame(replayTick);
}

function pauseReplayPlayback() {
  if (!state.replay || !state.replay.playing) {
    return;
  }

  state.replay.playing = false;
  state.replay.lastFrameTime = 0;
  stopReplayLoop();
  updateReplayUi();
  pushEvent("Replay paused", "Playback paused at " + formatReplayTime(state.replay.playheadMs) + ".", {
    sourceLabel: "Replay Overlay",
    sourceTone: "warn"
  });
}

function toggleReplayPlayback() {
  if (!state.replay) {
    return;
  }

  if (state.replay.playing) {
    pauseReplayPlayback();
    return;
  }

  startReplayPlayback();
}

function fitReplayBounds() {
  if (!state.replay || !state.replay.bounds) {
    return;
  }

  state.map.fitBounds(state.replay.bounds, { padding: [34, 34] });
}

function setLayerGroupVisibility(layer, visible) {
  if (!state.map || !layer) {
    return;
  }

  if (visible) {
    if (!state.map.hasLayer(layer)) {
      layer.addTo(state.map);
    }
    return;
  }

  if (state.map.hasLayer(layer)) {
    state.map.removeLayer(layer);
  }
}

function applyLiveMarkerVisibility() {
  setLayerGroupVisibility(state.liveMarkerLayer, state.layerVisibility.liveMarkers);
}

function applyLiveTrackVisibility() {
  setLayerGroupVisibility(state.liveTrackLayer, state.layerVisibility.liveTracks);
}

function applyReplayTrackVisibility() {
  setLayerGroupVisibility(state.replayPositionLayer, state.layerVisibility.replayTracks);
  setLayerGroupVisibility(state.replayTrailLayer, state.layerVisibility.replayTracks);
}

function applyReplayHistoryVisibility() {
  if (!state.replayHistoryLayer || !state.replay) {
    return;
  }

  setLayerGroupVisibility(
    state.replayHistoryLayer,
    state.replay.showHistory && state.layerVisibility.replayHistory
  );
}

function initializeReplay(dataset) {
  const historyLayer = L.geoJSON(dataset.fullHistoryGeojson, {
    style(feature) {
      return {
        color: feature.properties?.lineColor ?? "#f1b768",
        opacity: 0.42,
        weight: 2
      };
    }
  });
  const vesselStates = new Map();

  for (const vessel of dataset.vessels ?? []) {
    vesselStates.set(vessel.uid, {
      marker: null,
      markerMode: null,
      trail: null
    });
  }

  state.replayHistoryLayer = historyLayer;
  state.replay = {
    autoFollow: false,
    bounds: createReplayBounds(dataset.summary),
    endTimeMs: Date.parse(dataset.summary.endTime),
    historyLayer,
    lastFrameTime: 0,
    playheadMs: Date.parse(dataset.summary.startTime),
    playing: false,
    rafId: 0,
    showHistory: state.layerVisibility.replayHistory,
    showTrails: true,
    speed: Number(el.replaySpeed.value),
    startTimeMs: Date.parse(dataset.summary.startTime),
    summary: dataset.summary,
    vesselStates,
    vessels: dataset.vessels ?? [],
    visibleCount: 0
  };

  el.metaReplay.textContent =
    dataset.summary.trackPoints + " points / " + dataset.summary.vesselCount + " vessels";
  setReplayControlsEnabled(true);
  el.replayShowHistory.checked = state.layerVisibility.replayHistory;
  el.replayShowTrails.checked = true;
  el.replayAutoFollow.checked = false;
  el.replaySpeed.value = String(state.replay.speed);
  applyReplayTrackVisibility();
  applyReplayHistoryVisibility();
  renderReplayFrame(state.replay.playheadMs);
  fitReplayBounds();
  pushEvent(
    "Replay ready",
    "Loaded " + dataset.summary.vesselCount + " vessels across " + dataset.summary.trackPoints + " replay points.",
    {
      sourceLabel: "Replay Overlay",
      sourceTone: "warn"
    }
  );
  startReplayPlayback();
}

async function fetchJson(path, options = undefined) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Request failed");
  }

  return await response.json();
}

async function runTakQuery(kind) {
  const value = el.queryValue.value.trim();
  if (!value) {
    el.queryResultMode.textContent = "Missing value";
    el.queryResultNote.textContent = "Enter a UID or CoT ID first.";
    pushEvent("TAK query blocked", "Enter a UID or CoT ID before running a TAK query.", {
      sourceLabel: "TAK Query",
      sourceTone: "warn"
    });
    return;
  }

  if (kind === "cotId" && !/^\\d+$/.test(value)) {
    el.queryResultMode.textContent = "Invalid CoT ID";
    el.queryResultNote.textContent = "CoT ID lookups require an integer value.";
    pushEvent("TAK query blocked", "CoT ID lookups require an integer value.", {
      sourceLabel: "TAK Query",
      sourceTone: "warn"
    });
    return;
  }

  el.queryResultMode.textContent = "Querying";
  el.queryResultNote.textContent = kind === "uid"
    ? "Searching TAK for the requested UID..."
    : "Searching TAK for the requested CoT ID...";

  try {
    const query = kind === "uid"
      ? "/api/query?uid=" + encodeURIComponent(value)
      : "/api/query?cotId=" + encodeURIComponent(value);
    const result = await fetchJson(query);
    const event = result.event;
    const latlng = L.latLng(event.point.lat, event.point.lon);
    const timingCopy = buildReplayTimingCopy(
      getReplaySourceTime(event.remarks),
      event.time ?? event.start,
      "TAK event time"
    );

    setSelectedPoint(latlng);
    state.map.panTo(latlng);
    el.queryResultMode.textContent = "Resolved";
    el.queryResultNote.textContent =
      (event.callsign ?? event.uid) + " " + (event.type ?? "-") + " at " +
      formatCoordinate(event.point.lat) + ", " + formatCoordinate(event.point.lon) + "." +
      timingCopy;
    pushEvent(
      "TAK query resolved",
      "Resolved " + (kind === "uid" ? "UID " : "CoT ID ") + value + " to " +
        (event.callsign ?? event.uid) + " at " +
        formatCoordinate(event.point.lat) + ", " + formatCoordinate(event.point.lon) + "." +
        timingCopy,
      {
        sourceLabel: "TAK Query",
        sourceTone: "ok"
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    el.queryResultMode.textContent = "Query failed";
    el.queryResultNote.textContent = message;
    pushEvent("TAK query failed", message, {
      sourceLabel: "TAK Query",
      sourceTone: "fail"
    });
  }
}

function startLiveFeed() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
    el.toggleLive.textContent = "Start Live Feed";
    el.liveState.textContent = "Live off";
    setStreamConnectionState("Stopped", "warn", "Live CoT stream is stopped.");
    pushEvent("Live feed stopped", "Stopped streaming CoT updates.", {
      sourceLabel: "Live CoT",
      sourceTone: "ok"
    });
    return;
  }

  const source = new EventSource("/api/events");
  state.eventSource = source;
  el.toggleLive.textContent = "Stop Live Feed";
  el.liveState.textContent = "Connecting";
  setStreamConnectionState("Connecting", "warn", "Opening the live CoT event stream.");

  source.addEventListener("cot", (message) => {
    const payload = JSON.parse(message.data);
    el.liveState.textContent = "Live on";
    setStreamConnectionState("Connected", "ok", "Live CoT stream is connected and receiving events.");
    if (isReplayLikeEvent(payload.event) && !state.replay) {
      setReplayConnectionState(
        "Live replay detected",
        "ok",
        "Replay CoT is arriving from TAK over the live stream."
      );
    }
    upsertLiveTrack(payload.event);
    upsertLiveMarker(payload.event);
    const provenance = describeLiveEventProvenance(payload.event);
    const timingCopy = buildReplayTimingCopy(
      getReplaySourceTime(payload.event.remarks),
      payload.event.time ?? payload.event.start,
      "TAK event time"
    );
    pushEvent(
      payload.event.callsign ?? payload.event.uid,
      provenance.note + " " + (payload.event.type ?? "-") + " at " +
        formatCoordinate(payload.event.point.lat) + ", " + formatCoordinate(payload.event.point.lon) + "." +
        timingCopy,
      {
        sourceLabel: provenance.badge,
        sourceTone: provenance.tone
      }
    );
  });

  source.addEventListener("error", (message) => {
    try {
      const payload = JSON.parse(message.data);
      pushEvent("Live feed error", payload.message ?? "Stream closed.", {
        sourceLabel: "Live CoT",
        sourceTone: "fail"
      });
    } catch {
      pushEvent("Live feed error", "Stream closed.", {
        sourceLabel: "Live CoT",
        sourceTone: "fail"
      });
    }

    source.close();
    state.eventSource = null;
    el.toggleLive.textContent = "Start Live Feed";
    el.liveState.textContent = "Live off";
    setStreamConnectionState("Disconnected", "fail", "Live CoT stream disconnected. Start it again to retry.");
  });
}

async function refreshStatus() {
  const summary = await fetchJson("/api/status");
  renderStatus(summary);
}

async function refreshTargets() {
  try {
    const targets = await fetchJson("/api/targets");
    renderTargets(targets);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setLookupConnectionState("Map API error", "fail", message);
    setTargetLookupState("Lookup unavailable", "fail", message);
    el.targetCount.textContent = "0 targets";
    pushEvent("Targets unavailable", message, {
      sourceLabel: "Lookup",
      sourceTone: "fail"
    });
  }
}

async function refreshReplayTelemetry() {
  try {
    const payload = await fetchJson("/api/replay-telemetry");
    const telemetry = payload.telemetry;

    if (!telemetry) {
      resetReplayTelemetryUi();
      if (!state.replay) {
        setReplayConnectionState("Idle", "warn", "No replay activity yet.");
      }
      return;
    }

    el.replayInjectionStatus.textContent = telemetry.state;
    el.replaySentEvents.textContent = String(telemetry.sentEvents ?? 0);
    el.replayInjectSpeed.textContent = formatReplayTelemetrySpeed(telemetry.speed);
    el.replayLastSourceTime.textContent = telemetry.currentSourceTime ?? telemetry.startFromTime ?? "-";

    if (telemetry.state === "running") {
      setReplayConnectionState(
        "Injecting",
        "ok",
        "Replay injection is active at " + formatReplayTelemetrySpeed(telemetry.speed) + "."
      );
      return;
    }

    if (telemetry.state === "paused") {
      setReplayConnectionState(
        "Paused",
        "warn",
        "Replay injection is paused at source time " + (telemetry.currentSourceTime ?? "-") + "."
      );
      return;
    }

    if (telemetry.state === "completed") {
      setReplayConnectionState(
        "Completed",
        "warn",
        "Replay injection completed after " + telemetry.sentEvents + " events."
      );
      return;
    }

    if (telemetry.state === "stopped") {
      setReplayConnectionState(
        "Stopped",
        "warn",
        "Replay injection stopped after " + telemetry.sentEvents + " events."
      );
      return;
    }

    setReplayConnectionState("Idle", "warn", "Replay telemetry is available but not currently running.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!state.replay) {
      setReplayConnectionState("Telemetry error", "fail", message);
    }
    el.replayInjectionStatus.textContent = "Unavailable";
    el.replayInjectSpeed.textContent = "-";
    el.replayLastSourceTime.textContent = "-";
    el.replaySentEvents.textContent = "0";
  }
}

async function submitInject(event) {
  event.preventDefault();

  const payload = {
    uid: el.injectUid.value.trim(),
    callsign: el.injectCallsign.value.trim() || undefined,
    how: el.injectHow.value.trim() || undefined,
    lat: Number(el.injectLat.value),
    lon: Number(el.injectLon.value),
    remarks: el.injectRemarks.value.trim() || undefined,
    type: el.injectType.value.trim() || undefined
  };

  const result = await fetchJson("/api/inject", {
    body: JSON.stringify(payload),
    headers: {
      "content-type": "application/json"
    },
    method: "POST"
  });

  upsertLiveMarker(result.event);
  state.map.panTo([result.event.point.lat, result.event.point.lon]);
  pushEvent(
    "Injected " + (result.event.callsign ?? result.event.uid),
    "Sent " + result.event.type + " to TAK at " + formatCoordinate(result.event.point.lat) + ", " + formatCoordinate(result.event.point.lon),
    {
      sourceLabel: "Map Inject",
      sourceTone: "ok"
    }
  );
  ensureUidDefault();
}

function wireReplayControls() {
  el.replayToggle.addEventListener("click", () => {
    toggleReplayPlayback();
  });
  el.replayRestart.addEventListener("click", () => {
    pauseReplayPlayback();
    if (!state.replay) {
      return;
    }

    setReplayPlayhead(state.replay.startTimeMs);
    pushEvent("Replay restarted", "Playback reset to the start of the dataset.", {
      sourceLabel: "Replay Overlay",
      sourceTone: "warn"
    });
  });
  el.replayFit.addEventListener("click", () => {
    fitReplayBounds();
  });
  el.replaySpeed.addEventListener("change", () => {
    if (!state.replay) {
      return;
    }

    state.replay.speed = Number(el.replaySpeed.value);
    updateReplayUi();
    pushEvent("Replay speed changed", "Playback speed is now " + (REPLAY_SPEED_OPTIONS[state.replay.speed] ?? (state.replay.speed + "x")) + ".", {
      sourceLabel: "Replay Overlay",
      sourceTone: "warn"
    });
  });
  el.replayScrubber.addEventListener("input", () => {
    if (!state.replay) {
      return;
    }

    const progress = Number(el.replayScrubber.value) / 1000;
    const targetMs =
      state.replay.startTimeMs + (state.replay.endTimeMs - state.replay.startTimeMs) * progress;
    setReplayPlayhead(targetMs);
  });
  el.replayShowHistory.addEventListener("change", () => {
    state.layerVisibility.replayHistory = el.replayShowHistory.checked;
    if (state.replay) {
      state.replay.showHistory = el.replayShowHistory.checked;
    }
    applyReplayHistoryVisibility();
  });
  el.replayShowTrails.addEventListener("change", () => {
    if (!state.replay) {
      return;
    }

    state.replay.showTrails = el.replayShowTrails.checked;
    renderReplayFrame(state.replay.playheadMs);
  });
  el.replayAutoFollow.addEventListener("change", () => {
    if (!state.replay) {
      return;
    }

    state.replay.autoFollow = el.replayAutoFollow.checked;
  });
  el.markerMode.addEventListener("change", () => {
    state.markerMode = el.markerMode.value;
    rerenderTargetMarkerIcons();
    rerenderLiveMarkerIcons();
    if (state.replay) {
      renderReplayFrame(state.replay.playheadMs);
    }
    pushEvent(
      "Marker symbology changed",
      state.markerMode === "2525"
        ? "Using 2525-style contact symbols."
        : "Using simple dot markers.",
      {
        sourceLabel: "System",
        sourceTone: "neutral"
      }
    );
  });
}

function wireLayerControls() {
  el.layerLiveMarkers.checked = state.layerVisibility.liveMarkers;
  el.layerLiveTracks.checked = state.layerVisibility.liveTracks;
  el.layerReplayTracks.checked = state.layerVisibility.replayTracks;
  el.replayShowHistory.checked = state.layerVisibility.replayHistory;

  el.layerLiveMarkers.addEventListener("change", () => {
    state.layerVisibility.liveMarkers = el.layerLiveMarkers.checked;
    applyLiveMarkerVisibility();
    pushEvent(
      "Layer visibility changed",
      el.layerLiveMarkers.checked ? "Live markers are visible." : "Live markers are hidden.",
      {
        sourceLabel: "System",
        sourceTone: "neutral"
      }
    );
  });

  el.layerLiveTracks.addEventListener("change", () => {
    state.layerVisibility.liveTracks = el.layerLiveTracks.checked;
    applyLiveTrackVisibility();
    pushEvent(
      "Layer visibility changed",
      el.layerLiveTracks.checked ? "Live tracks are visible." : "Live tracks are hidden.",
      {
        sourceLabel: "System",
        sourceTone: "neutral"
      }
    );
  });

  el.layerReplayTracks.addEventListener("change", () => {
    state.layerVisibility.replayTracks = el.layerReplayTracks.checked;
    applyReplayTrackVisibility();
    pushEvent(
      "Layer visibility changed",
      el.layerReplayTracks.checked ? "Replay tracks are visible." : "Replay tracks are hidden.",
      {
        sourceLabel: "System",
        sourceTone: "neutral"
      }
    );
  });
}

function wireTakActions() {
  el.queryUid.addEventListener("click", () => {
    void runTakQuery("uid");
  });

  el.queryCotId.addEventListener("click", () => {
    void runTakQuery("cotId");
  });
}

async function boot() {
  const meta = await fetchJson("/api/meta");

  el.metaProfile.textContent = meta.profile.name ?? "(ad-hoc)";
  el.metaServer.textContent = meta.profile.server;
  el.metaCotPort.textContent = String(meta.profile.ports.cot);
  el.metaReplay.textContent = meta.replaySummary
    ? meta.replaySummary.trackPoints + " points / " + meta.replaySummary.vesselCount + " vessels"
    : "None";

  state.map = L.map("map", {
    zoomControl: true
  }).setView([-35.0, 138.6], 9);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19
  }).addTo(state.map);

  state.targetLayer = L.layerGroup().addTo(state.map);
  state.liveMarkerLayer = L.layerGroup().addTo(state.map);
  state.liveTrackLayer = L.layerGroup().addTo(state.map);
  state.replayPositionLayer = L.layerGroup().addTo(state.map);
  state.replayTrailLayer = L.layerGroup().addTo(state.map);
  applyLiveMarkerVisibility();
  applyLiveTrackVisibility();
  applyReplayTrackVisibility();

  state.map.on("click", (mapEvent) => {
    setSelectedPoint(mapEvent.latlng);
  });

  state.map.whenReady(() => {
    const center = state.map.getCenter();
    updateInjectFields(center.lat, center.lng, "Map Center");
  });

  state.markerMode = el.markerMode.value;
  ensureUidDefault();
  setReplayControlsEnabled(false);
  updateReplayUi();
  renderConnectionStates();
  wireReplayControls();
  wireLayerControls();
  wireTakActions();

  if (meta.autoStartLive) {
    setStreamConnectionState("Connecting", "warn", "Opening the live CoT event stream.");
  } else {
    setStreamConnectionState("Stopped", "warn", "Live CoT stream is not started yet.");
  }

  setLookupConnectionState("Pending", "warn", "Waiting for the first HTTP target lookup.");

  if (meta.replaySummary) {
    const replay = await fetchJson("/api/replay");
    initializeReplay(replay);
  }

  await refreshReplayTelemetry();
  state.replayTelemetryPollId = window.setInterval(() => {
    void refreshReplayTelemetry();
  }, 2000);

  if (meta.autoStartLive) {
    startLiveFeed();
  }
  await refreshStatus();
  await refreshTargets();

  el.refreshStatus.addEventListener("click", () => {
    void refreshStatus();
  });
  el.refreshTargets.addEventListener("click", () => {
    void refreshTargets();
  });
  el.toggleLive.addEventListener("click", () => {
    startLiveFeed();
  });
  el.toggleSidebar.addEventListener("click", () => {
    toggleSidebar();
  });
  el.useMapCenter.addEventListener("click", () => {
    const center = state.map.getCenter();
    updateInjectFields(center.lat, center.lng, "Map Center");
  });
  el.useSelectedPoint.addEventListener("click", () => {
    if (state.lastSelectedPoint) {
      updateInjectFields(state.lastSelectedPoint.lat, state.lastSelectedPoint.lng, "Selected Point");
      return;
    }

    pushEvent("No selected point", "Click on the map first or use the current map center.", {
      sourceLabel: "System",
      sourceTone: "neutral"
    });
  });
  el.injectForm.addEventListener("submit", (event) => {
    void submitInject(event);
  });

  pushEvent("Console ready", "TAKCLI map UI connected. Activity entries now label TAK lookup, live CoT, and replay-fed sources.", {
    sourceLabel: "System",
    sourceTone: "neutral"
  });
}

void boot().catch((error) => {
  console.error(error);
  setStatusPill("Startup failed", "fail");
  pushEvent("Startup failed", error instanceof Error ? error.message : String(error), {
    sourceLabel: "System",
    sourceTone: "fail"
  });
});
`;

export function buildPlaceholderLogoSvg(label: string): string {
  const escapedLabel = escapeHtml(label);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" role="img" aria-label="${escapedLabel}">
  <defs>
    <linearGradient id="takcli-logo-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#7ee0c3" />
      <stop offset="100%" stop-color="#f1b768" />
    </linearGradient>
  </defs>
  <rect x="10" y="10" width="140" height="140" rx="28" fill="#102531" stroke="url(#takcli-logo-gradient)" stroke-width="4" />
  <path d="M52 110L80 48L108 110" fill="none" stroke="url(#takcli-logo-gradient)" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" />
  <path d="M63 92H97" fill="none" stroke="#ebf6f2" stroke-width="8" stroke-linecap="round" />
  <text x="80" y="134" fill="#97b7bd" font-family="IBM Plex Sans, Avenir Next, Segoe UI, sans-serif" font-size="12" text-anchor="middle">${escapedLabel}</text>
</svg>`;
}
