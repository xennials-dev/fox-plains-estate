/**
 * EstateSphere Immersive 3D Spatial Suite
 * 
 * Implements:
 * 1. 6 Degrees of Freedom (6DoF) Virtual House Viewing (3 Rotational + 3 Translational Axes + Spatial Mode)
 * 2. Node-Based 3D Walkthrough View (Matterport-style bubble navigation with glowing floor targets)
 * 3. 3D Dollhouse View (Multi-story cross-section miniature maquette with rotate & tilt)
 * 4. Top-Down 2D/3D Floor Plan View (Interactive blueprint with live user position radar & teleportation)
 */

(function () {
  'use strict';

  // --- AUDIO SYNTHESIS ENGINE (Footsteps & Ambience) ---
  class SpatialAudio {
    constructor() {
      this.ctx = null;
      this.enabled = true;
    }
    init() {
      if (!this.ctx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) this.ctx = new AudioContext();
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    }
    playStep() {
      if (!this.enabled || !this.ctx) return;
      try {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(75 + Math.random() * 20, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(30, this.ctx.currentTime + 0.08);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(350, this.ctx.currentTime);

        gain.gain.setValueAtTime(0.06, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.08);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + 0.08);
      } catch (_) {}
    }
    playTeleport() {
      if (!this.enabled || !this.ctx) return;
      try {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(260, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(520, this.ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.15);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.15);
      } catch (_) {}
    }
  }

  // --- MAIN VIEWER CLASS ---
  class SpatialViewer {
    constructor(containerId) {
      this.container = document.getElementById(containerId);
      if (!this.container) return;

      this.audio = new SpatialAudio();
      this.currentMode = '6dof'; // '6dof' | 'nodes' | 'dollhouse' | 'floorplan'
      this.activeLevel = 'all';  // 'all' | 'main' | 'lower'
      this.isVisionPro = false;
      this.isPointerLocked = false;

      // 6DoF Camera & Movement State
      this.cameraPos = new THREE.Vector3(0, 1.6, 7); // Eye level at entry
      this.cameraRot = { yaw: 0, pitch: 0, roll: 0 };
      this.moveState = { forward: 0, backward: 0, left: 0, right: 0, up: 0, down: 0, sprint: false };
      this.velocity = new THREE.Vector3();
      this.stepTimer = 0;

      // Node Walkthrough State
      this.nodes = [
        { id: 'node-foyer', name: 'Front Foyer & Entry', pos: new THREE.Vector3(0, 1.6, 7), desc: 'Grand entry looking toward living room' },
        { id: 'node-living', name: 'Great Living Room', pos: new THREE.Vector3(2.5, 1.6, 2), desc: 'Painted brick fireplace & picture window' },
        { id: 'node-kitchen', name: 'Chef Kitchen & Island', pos: new THREE.Vector3(-4.5, 1.6, -1), desc: 'Quartz waterfall island & breakfast nook' },
        { id: 'node-primary', name: 'Primary Suite Sanctuary', pos: new THREE.Vector3(7, 1.6, -2), desc: 'Quiet retreat with garden view' },
        { id: 'node-lower', name: 'Finished Lower Level', pos: new THREE.Vector3(-3.5, -2.6, 3), desc: 'Expansive rec room with wet bar' },
        { id: 'node-patio', name: 'Stamped Patio & Backyard', pos: new THREE.Vector3(-5, 1.4, -9), desc: 'Outdoor living & flat fenced lawn' }
      ];
      this.activeNodeIndex = 0;
      this.isTransitioning = false;

      // Dollhouse & Floorplan Cam Positions
      this.dollhouseCamPos = new THREE.Vector3(18, 16, 18);
      this.floorplanCamPos = new THREE.Vector3(0, 32, 0.01);

      // Animation & Interaction
      this.raycaster = new THREE.Raycaster();
      this.mouse = new THREE.Vector2();
      this.interactiveTargets = [];
      this.nodeRings = [];
      this.roomPins = [];

      this.init();
    }

    init() {
      // 1. Build DOM Structure
      this.buildDOM();

      // 2. Setup Three.js
      this.setupThree();

      // 3. Build Architectural 3D Model
      this.buildHouseModel();

      // 4. Setup Mode-Specific Entities
      this.createNodeRings();
      this.createDollhousePins();

      // 5. Setup Controls & Listeners
      this.setupInputListeners();

      // 6. Setup Visibility Observer (Pauses WebGL when offscreen)
      this.setupVisibilityObserver();

      // 7. Start Loop
      this.lastTime = performance.now();
      this.animate();

      // Initial Mode Setup
      this.setMode('6dof');
    }

    setupVisibilityObserver() {
      this.isVisible = true;
      this.isLoopRunning = false;
      if ('IntersectionObserver' in window && this.container) {
        const observer = new IntersectionObserver((entries) => {
          this.isVisible = entries[0].isIntersecting;
          if (this.isVisible && !this.isLoopRunning) {
            this.lastTime = performance.now();
            this.animate();
          }
        }, { threshold: 0.05 });
        observer.observe(this.container);
      }
    }

    buildDOM() {
      this.container.innerHTML = `
        <div class="spatial-suite">
          <!-- TOP MODE SWITCHER BAR -->
          <div class="spatial-nav">
            <div class="spatial-modes" role="tablist" aria-label="3D Viewing Modes">
              <button class="spatial-mode-btn is-active" data-mode="6dof" title="6 Degrees of Freedom Free Walkthrough">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                <span>6DoF Free-Roam</span>
              </button>
              <button class="spatial-mode-btn" data-mode="nodes" title="Node-Based 3D Bubble Walkthrough (Matterport style)">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>
                <span>Node 360° Tour</span>
              </button>
              <button class="spatial-mode-btn" data-mode="dollhouse" title="3D Miniature Cutaway Model">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                <span>3D Dollhouse</span>
              </button>
              <button class="spatial-mode-btn" data-mode="floorplan" title="Architectural Blueprint Top-Down View">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
                <span>Top-Down Blueprint</span>
              </button>
              <button class="spatial-mode-btn" data-mode="drone" title="Autonomous 3D Drone Flight Path with Exact Interior Shots">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 0-3 3c0 .88.39 1.67 1 2.22V9H6a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h4v1.78A3.001 3.001 0 0 0 12 22a3 3 0 0 0 2-5.22V15h4a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-4V7.22c.61-.55 1-1.34 1-2.22a3 3 0 0 0-3-3zM4 5h3M17 5h3M4 19h3M17 19h3"/></svg>
                <span style="color:#8cf5b7;">3D Drone View</span>
              </button>
            </div>

            <div class="spatial-actions">
              <button class="spatial-icon-btn" id="btnVisionPro" title="Toggle Apple Vision Pro / Spatial Headset View">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 10c0-3.3 2.7-6 6-6h8c3.3 0 6 2.7 6 6v4c0 3.3-2.7 6-6 6H8c-3.3 0-6-2.7-6-6v-4z"/><circle cx="8" cy="12" r="2.5"/><circle cx="16" cy="12" r="2.5"/></svg>
                <span class="btn-text">Spatial Mode</span>
              </button>
              <button class="spatial-icon-btn" id="btnAudioToggle" title="Sound Effects (Footsteps & Reverb)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" id="audioIcon"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
              </button>
              <button class="spatial-icon-btn" id="btnResetView" title="Reset Camera Position">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><polyline points="3 3 3 8 8 8"/></svg>
              </button>
              <button class="spatial-icon-btn" id="btnFullscreen" title="Toggle Fullscreen">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
              </button>
            </div>
          </div>

          <!-- 3D CANVAS VIEWPORT -->
          <div class="spatial-viewport" id="spatialViewport">
            <canvas id="spatialCanvas"></canvas>

            <!-- 3D DRONE VIEW OVERLAY -->
            <div class="spatial-drone-overlay" id="spatialDroneOverlay" style="display:none;">
              <div class="drone-overlay-bar">
                <div class="drone-status-indicator">
                  <span class="drone-live-dot"></span>
                  <strong style="color:var(--gold, #c9a86a); font-size:11px; letter-spacing:0.12em;">AUTONOMOUS DRONE CONNECTED</strong>
                  <span class="drone-sub-pill">Spline Route · Exact Interior Overlays</span>
                </div>
                <div class="drone-bar-actions">
                  <a href="http://localhost:5173/" target="_blank" rel="noopener" class="drone-popout-btn" title="Open Drone View in Dedicated Tab">
                    <span>Standalone (5173) ↗</span>
                  </a>
                  <button type="button" class="drone-close-btn" id="btnExitDrone" title="Switch back to 6DoF Free-Roam">
                    <span>Exit Drone ✕</span>
                  </button>
                </div>
              </div>
              <iframe id="spatialDroneIframe" class="drone-iframe" src="" allow="autoplay; accelerometer; gyroscope"></iframe>
            </div>

            <!-- 6DOF RETICLE & PROMPT -->
            <div class="spatial-reticle" id="spatialReticle">
              <div class="reticle-dot"></div>
              <div class="reticle-inspect" id="reticleInspect">Click / Drag to Look · WASD to Walk</div>
            </div>

            <!-- VISION PRO SPATIAL BEZEL OVERLAY -->
            <div class="vision-pro-overlay" id="visionProOverlay">
              <div class="vision-pro-lens lens-left"></div>
              <div class="vision-pro-lens lens-right"></div>
              <div class="vision-pro-hud">Apple Vision Pro Spatial 6DoF · 8K Virtual Twin</div>
            </div>

            <!-- TELEMETRY HUD -->
            <div class="spatial-telemetry" id="spatialTelemetry">
              <div class="telemetry-item"><span class="t-label">ZONE:</span> <b id="tZone">Great Living Room</b></div>
              <div class="telemetry-item"><span class="t-label">COORDS:</span> <span id="tCoords">X: 0.0 Y: 1.6 Z: 7.0</span></div>
              <div class="telemetry-item"><span class="t-label">6DoF AXES:</span> <span id="tAxes">Pitch: 0° · Yaw: 0° · Roll: 0°</span></div>
              <div class="telemetry-item"><span class="t-label">ELEVATION:</span> <span id="tElev">1.60 m (Eye Level)</span></div>
            </div>

            <!-- LEVEL SWITCHER (FOR DOLLHOUSE & BLUEPRINT) -->
            <div class="spatial-levels" id="spatialLevels">
              <button class="level-btn is-active" data-level="all">All Levels</button>
              <button class="level-btn" data-level="main">Main Level (1,300 sq ft)</button>
              <button class="level-btn" data-level="lower">Lower Level Rec (Finished)</button>
            </div>

            <!-- NODE QUICK SWITCHER CAROUSEL -->
            <div class="spatial-nodes-strip" id="spatialNodesStrip">
              <!-- Dynamically populated -->
            </div>

            <!-- MOBILE JOYSTICKS -->
            <div class="spatial-mobile-controls" id="spatialMobileControls">
              <div class="virtual-stick stick-move" id="stickMove">
                <div class="stick-knob" id="knobMove"></div>
                <span class="stick-label">MOVE</span>
              </div>
              <div class="vertical-elevation-controls">
                <button class="vert-btn" id="btnElevUp" title="Elevate / Stand Up">▲</button>
                <button class="vert-btn" id="btnElevDown" title="Crouch / Descend">▼</button>
              </div>
              <div class="virtual-stick stick-look" id="stickLook">
                <div class="stick-knob" id="knobLook"></div>
                <span class="stick-label">LOOK</span>
              </div>
            </div>

            <!-- MINI-RADAR CORNER MAP -->
            <div class="spatial-minimap" id="spatialMinimap" title="Click to open Full Floor Plan Blueprint">
              <div class="minimap-blueprint">
                <div class="minimap-room r-living">LIVING</div>
                <div class="minimap-room r-kitchen">KITCHEN</div>
                <div class="minimap-room r-primary">BED 1</div>
                <div class="minimap-room r-patio">PATIO</div>
                <div class="minimap-beacon" id="minimapBeacon">
                  <div class="beacon-cone" id="beaconCone"></div>
                </div>
              </div>
              <span class="minimap-caption">RADAR ↗</span>
            </div>

            <!-- KEYBOARD HELP CUE -->
            <div class="spatial-help-bar" id="spatialHelpBar">
              <span><b>WASD / Arrows:</b> Walk</span>
              <span><b>Mouse Drag:</b> 360° Look</span>
              <span><b>Space / C:</b> Stand / Crouch</span>
              <span><b>Shift:</b> Sprint</span>
              <span><b>Click Rings / Rooms:</b> Teleport</span>
            </div>
          </div>
        </div>
      `;

      // Inject CSS
      this.injectStyles();
    }

    injectStyles() {
      if (document.getElementById('spatialSuiteStyles')) return;
      const style = document.createElement('style');
      style.id = 'spatialSuiteStyles';
      style.textContent = `
        .spatial-suite {
          position: relative;
          background: #060709;
          border: 1px solid var(--line-gold, rgba(201,168,106,.3));
          border-radius: 6px;
          overflow: hidden;
          margin-top: 36px;
          box-shadow: 0 20px 60px rgba(0,0,0,.7), 0 0 40px rgba(201,168,106,.1);
          font-family: var(--sans, 'Inter', sans-serif);
        }
        .spatial-nav {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 12px;
          padding: 12px 18px;
          background: rgba(13,15,18,.92);
          backdrop-filter: blur(14px);
          border-bottom: 1px solid var(--line, rgba(244,241,234,.12));
          z-index: 10;
        }
        .spatial-modes {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }
        .spatial-mode-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          border-radius: 999px;
          border: 1px solid var(--line, rgba(244,241,234,.15));
          background: rgba(20,24,29,.6);
          color: var(--muted, rgba(244,241,234,.7));
          font-size: 9.5px;
          letter-spacing: .2em;
          text-transform: uppercase;
          transition: all .35s var(--ease, ease);
          cursor: pointer;
        }
        .spatial-mode-btn:hover {
          color: var(--gold, #c9a86a);
          border-color: var(--gold, #c9a86a);
          background: rgba(201,168,106,.1);
        }
        .spatial-mode-btn.is-active {
          background: var(--gold, #c9a86a);
          color: #08090b;
          font-weight: 500;
          border-color: var(--gold, #c9a86a);
          box-shadow: 0 2px 14px rgba(201,168,106,.3);
        }
        .spatial-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .spatial-icon-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 12px;
          border-radius: 999px;
          border: 1px solid var(--line, rgba(244,241,234,.15));
          background: rgba(20,24,29,.6);
          color: var(--muted, rgba(244,241,234,.7));
          font-size: 9px;
          letter-spacing: .15em;
          text-transform: uppercase;
          cursor: pointer;
          transition: all .3s;
        }
        .spatial-icon-btn:hover {
          color: var(--gold, #c9a86a);
          border-color: var(--gold, #c9a86a);
        }
        .spatial-icon-btn.is-active {
          background: rgba(201,168,106,.2);
          border-color: var(--gold, #c9a86a);
          color: var(--gold, #c9a86a);
        }
        .spatial-viewport {
          position: relative;
          width: 100%;
          height: 640px;
          overflow: hidden;
          background: #000;
          touch-action: none;
        }
        #spatialCanvas {
          width: 100%;
          height: 100%;
          display: block;
        }
        
        /* Reticle & Prompt */
        .spatial-reticle {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          pointer-events: none;
          z-index: 5;
        }
        .reticle-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--gold, #c9a86a);
          box-shadow: 0 0 8px var(--gold, #c9a86a);
          transition: transform .2s, opacity .2s;
        }
        .reticle-inspect {
          position: absolute;
          bottom: 30px;
          padding: 8px 18px;
          background: rgba(7,8,10,.78);
          backdrop-filter: blur(10px);
          border: 1px solid var(--line-gold, rgba(201,168,106,.3));
          border-radius: 999px;
          color: var(--ink, #f4f1ea);
          font-size: 10.5px;
          letter-spacing: .18em;
          text-transform: uppercase;
          box-shadow: 0 4px 20px rgba(0,0,0,.6);
          transition: all .3s;
        }

        /* Vision Pro Bezel */
        .vision-pro-overlay {
          position: absolute;
          inset: 0;
          pointer-events: none;
          display: flex;
          opacity: 0;
          transition: opacity .5s;
          z-index: 6;
        }
        .vision-pro-overlay.is-active {
          opacity: 1;
        }
        .vision-pro-lens {
          flex: 1;
          height: 100%;
          border: 8px solid rgba(255,255,255,.08);
          border-radius: 36px;
          margin: 12px;
          box-shadow: inset 0 0 80px rgba(0,0,0,.85), 0 0 40px rgba(100,180,255,.15);
        }
        .vision-pro-hud {
          position: absolute;
          top: 20px;
          left: 50%;
          transform: translateX(-50%);
          padding: 6px 16px;
          background: rgba(255,255,255,.12);
          backdrop-filter: blur(20px);
          border-radius: 999px;
          color: #fff;
          font-size: 9px;
          letter-spacing: .25em;
          text-transform: uppercase;
        }

        /* Telemetry HUD */
        .spatial-telemetry {
          position: absolute;
          top: 16px;
          left: 16px;
          background: rgba(7,8,10,.82);
          backdrop-filter: blur(12px);
          border: 1px solid var(--line, rgba(244,241,234,.12));
          padding: 12px 16px;
          border-radius: 6px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-size: 10px;
          color: var(--muted, rgba(244,241,234,.7));
          pointer-events: none;
          z-index: 5;
        }
        .telemetry-item b {
          color: var(--gold, #c9a86a);
        }
        .t-label {
          color: var(--faint, rgba(244,241,234,.4));
          letter-spacing: .15em;
        }

        /* Level Switcher */
        .spatial-levels {
          position: absolute;
          top: 16px;
          right: 16px;
          display: none;
          flex-direction: column;
          gap: 6px;
          z-index: 5;
        }
        .spatial-levels.is-visible {
          display: flex;
        }
        .level-btn {
          padding: 8px 14px;
          border-radius: 6px;
          background: rgba(13,15,18,.85);
          backdrop-filter: blur(10px);
          border: 1px solid var(--line, rgba(244,241,234,.15));
          color: var(--muted, rgba(244,241,234,.7));
          font-size: 9px;
          letter-spacing: .15em;
          text-transform: uppercase;
          cursor: pointer;
          transition: all .3s;
        }
        .level-btn:hover {
          color: var(--gold, #c9a86a);
          border-color: var(--gold, #c9a86a);
        }
        .level-btn.is-active {
          background: var(--gold, #c9a86a);
          color: #08090b;
          font-weight: 500;
          border-color: var(--gold, #c9a86a);
        }

        /* Nodes Carousel Strip */
        .spatial-nodes-strip {
          position: absolute;
          bottom: 45px;
          left: 50%;
          transform: translateX(-50%);
          display: none;
          gap: 8px;
          padding: 8px 12px;
          background: rgba(7,8,10,.85);
          backdrop-filter: blur(14px);
          border: 1px solid var(--line-gold, rgba(201,168,106,.3));
          border-radius: 999px;
          z-index: 5;
          max-width: 90vw;
          overflow-x: auto;
        }
        .spatial-nodes-strip.is-visible {
          display: flex;
        }
        .node-bubble-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 14px;
          border-radius: 999px;
          border: 1px solid var(--line, rgba(244,241,234,.12));
          background: rgba(20,24,29,.6);
          color: var(--muted, rgba(244,241,234,.75));
          font-size: 9px;
          letter-spacing: .18em;
          text-transform: uppercase;
          white-space: nowrap;
          cursor: pointer;
          transition: all .3s;
        }
        .node-bubble-btn:hover {
          color: var(--gold, #c9a86a);
          border-color: var(--gold, #c9a86a);
        }
        .node-bubble-btn.is-active {
          background: var(--gold, #c9a86a);
          color: #08090b;
          border-color: var(--gold, #c9a86a);
          font-weight: 500;
        }

        /* Minimap Radar */
        .spatial-minimap {
          position: absolute;
          bottom: 16px;
          right: 16px;
          width: 140px;
          height: 100px;
          background: rgba(7,8,10,.85);
          backdrop-filter: blur(10px);
          border: 1px solid var(--line-gold, rgba(201,168,106,.3));
          border-radius: 6px;
          overflow: hidden;
          cursor: pointer;
          transition: transform .3s, border-color .3s;
          z-index: 5;
        }
        .spatial-minimap:hover {
          transform: scale(1.05);
          border-color: var(--gold, #c9a86a);
        }
        .minimap-blueprint {
          position: relative;
          width: 100%;
          height: 100%;
          display: grid;
          grid-template-columns: 1fr 1fr;
          grid-template-rows: 1fr 1fr;
          gap: 2px;
          padding: 6px;
          background: rgba(0,20,40,.2);
        }
        .minimap-room {
          border: 1px dashed rgba(201,168,106,.3);
          font-size: 7px;
          letter-spacing: .1em;
          color: rgba(244,241,234,.4);
          display: grid;
          place-items: center;
        }
        .minimap-beacon {
          position: absolute;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--gold, #c9a86a);
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          box-shadow: 0 0 6px var(--gold, #c9a86a);
          pointer-events: none;
        }
        .beacon-cone {
          position: absolute;
          top: 4px;
          left: 4px;
          width: 0;
          height: 0;
          border-left: 12px solid transparent;
          border-right: 12px solid transparent;
          border-top: 24px solid rgba(201,168,106,.4);
          transform-origin: 0 0;
          transform: translate(-12px, -24px);
        }
        .minimap-caption {
          position: absolute;
          bottom: 3px;
          right: 5px;
          font-size: 7px;
          letter-spacing: .15em;
          color: var(--gold, #c9a86a);
        }

        /* Help Bar */
        .spatial-help-bar {
          position: absolute;
          bottom: 12px;
          left: 16px;
          display: flex;
          gap: 12px;
          font-size: 8.5px;
          letter-spacing: .12em;
          color: var(--faint, rgba(244,241,234,.4));
          background: rgba(7,8,10,.7);
          backdrop-filter: blur(8px);
          padding: 6px 12px;
          border-radius: 4px;
          pointer-events: none;
          z-index: 4;
        }
        .spatial-help-bar b {
          color: var(--gold-soft, #e6d3a3);
        }

        /* Mobile Joysticks */
        .spatial-mobile-controls {
          position: absolute;
          inset: 0;
          pointer-events: none;
          display: none;
          z-index: 7;
        }
        @media (max-width: 900px) {
          .spatial-mobile-controls { display: flex; }
          .spatial-help-bar { display: none; }
          .spatial-telemetry { font-size: 8px; padding: 8px; }
        }
        .virtual-stick {
          position: absolute;
          bottom: 24px;
          width: 80px;
          height: 80px;
          border-radius: 50%;
          background: rgba(255,255,255,.08);
          border: 1px solid rgba(255,255,255,.2);
          pointer-events: auto;
          touch-action: none;
        }
        .stick-move { left: 24px; }
        .stick-look { right: 24px; }
        .stick-knob {
          position: absolute;
          top: 25px;
          left: 25px;
          width: 30px;
          height: 30px;
          border-radius: 50%;
          background: var(--gold, #c9a86a);
          box-shadow: 0 0 10px rgba(0,0,0,.5);
        }
        .stick-label {
          position: absolute;
          bottom: -18px;
          left: 0;
          right: 0;
          text-align: center;
          font-size: 7.5px;
          letter-spacing: .2em;
          color: rgba(255,255,255,.5);
        }
        .vertical-elevation-controls {
          position: absolute;
          bottom: 30px;
          left: 115px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          pointer-events: auto;
        }
        .vert-btn {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: rgba(20,24,29,.8);
          border: 1px solid var(--line, rgba(244,241,234,.2));
          color: var(--gold, #c9a86a);
          font-size: 11px;
          cursor: pointer;
        }

        /* 3D Drone View Overlay */
        .spatial-drone-overlay {
          position: absolute;
          inset: 0;
          z-index: 25;
          background: #090b0e;
          display: flex;
          flex-direction: column;
        }
        .drone-overlay-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 10px;
          padding: 8px 16px;
          background: rgba(8, 10, 13, 0.95);
          backdrop-filter: blur(14px);
          border-bottom: 1px solid rgba(140, 245, 183, 0.25);
          z-index: 30;
        }
        .drone-status-indicator {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 11px;
          color: #fff;
        }
        .drone-live-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #8cf5b7;
          box-shadow: 0 0 12px rgba(140, 245, 183, 0.9);
          animation: dronePulse 1.8s infinite ease-in-out;
        }
        @keyframes dronePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.85); }
        }
        .drone-sub-pill {
          font-size: 9px;
          padding: 2px 8px;
          border-radius: 999px;
          background: rgba(140, 245, 183, 0.12);
          color: #8cf5b7;
          border: 1px solid rgba(140, 245, 183, 0.3);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .drone-bar-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .drone-popout-btn, .drone-close-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 12px;
          border-radius: 6px;
          font-size: 9.5px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          cursor: pointer;
          text-decoration: none;
          transition: all 0.2s ease;
          border: 1px solid rgba(255, 255, 255, 0.15);
          background: rgba(20, 24, 29, 0.85);
          color: #edf3f7;
        }
        .drone-popout-btn:hover {
          background: rgba(140, 245, 183, 0.15);
          color: #8cf5b7;
          border-color: #8cf5b7;
        }
        .drone-close-btn:hover {
          background: rgba(230, 80, 80, 0.2);
          color: #ff9e9e;
          border-color: rgba(230, 80, 80, 0.4);
        }
        .drone-iframe {
          flex: 1;
          width: 100%;
          height: 100%;
          border: 0;
          display: block;
          background: #090b0e;
        }
      `;
      document.head.appendChild(style);
    }

    setupThree() {
      const width = this.container.clientWidth || window.innerWidth;
      const height = 640;

      // Scene
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x0a0c0f);
      this.scene.fog = new THREE.FogExp2(0x0a0c0f, 0.015);

      // Camera
      this.camera = new THREE.PerspectiveCamera(65, width / height, 0.1, 1000);
      this.camera.position.copy(this.cameraPos);

      // Renderer
      const canvas = document.getElementById('spatialCanvas');
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
      this.renderer.setSize(width, height);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      // OrbitControls (Used for Dollhouse & Floorplan modes)
      this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.05;
      this.controls.maxPolarAngle = Math.PI / 2 - 0.05; // Don't go below ground
      this.controls.enabled = false; // Disabled during 6DoF

      // Lights
      this.setupLighting();

      // Handle Resize
      window.addEventListener('resize', () => this.onResize());
    }

    setupLighting() {
      // Ambient Fill
      const ambientLight = new THREE.AmbientLight(0xfff5ea, 0.45);
      this.scene.add(ambientLight);

      // Directional Sun
      const sunLight = new THREE.DirectionalLight(0xfff2dc, 0.85);
      sunLight.position.set(15, 24, 18);
      sunLight.castShadow = true;
      sunLight.shadow.mapSize.width = 1024;
      sunLight.shadow.mapSize.height = 1024;
      sunLight.shadow.camera.near = 0.5;
      sunLight.shadow.camera.far = 60;
      sunLight.shadow.camera.left = -20;
      sunLight.shadow.camera.right = 20;
      sunLight.shadow.camera.top = 20;
      sunLight.shadow.camera.bottom = -20;
      this.scene.add(sunLight);

      // Hearth Point Light (Living Room)
      const hearthLight = new THREE.PointLight(0xffaa44, 1.2, 12);
      hearthLight.position.set(3.5, 1.2, 2.5);
      this.scene.add(hearthLight);

      // Kitchen Pendant Point Light
      const kitchenLight = new THREE.PointLight(0xfffaed, 0.9, 10);
      kitchenLight.position.set(-4.5, 2.4, -1);
      this.scene.add(kitchenLight);

      // Lower Level Warm Rec Light
      const recLight = new THREE.PointLight(0xffd599, 1.1, 14);
      recLight.position.set(-3.5, -1.8, 3);
      this.scene.add(recLight);
    }

    buildHouseModel() {
      this.houseGroup = new THREE.Group();
      this.scene.add(this.houseGroup);

      // Procedural Texture Generator Helpers
      const makeGridTexture = (col1, col2, size = 16) => {
        const c = document.createElement('canvas');
        c.width = c.height = 128;
        const ctx = c.getContext('2d');
        ctx.fillStyle = col1;
        ctx.fillRect(0, 0, 128, 128);
        ctx.fillStyle = col2;
        ctx.fillRect(0, 0, 128, 4);
        ctx.fillRect(0, 0, 4, 128);
        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(size, size);
        return tex;
      };

      const makeWoodTexture = () => {
        const c = document.createElement('canvas');
        c.width = 256; c.height = 256;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#6b4423';
        ctx.fillRect(0, 0, 256, 256);
        ctx.fillStyle = '#523318';
        for (let i = 0; i < 256; i += 16) {
          ctx.fillRect(0, i, 256, 1);
        }
        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(8, 8);
        return tex;
      };

      // Materials
      const woodFloorMat = new THREE.MeshStandardMaterial({
        color: 0x8a5a36, roughness: 0.35, metalness: 0.1, map: makeWoodTexture()
      });
      const tileFloorMat = new THREE.MeshStandardMaterial({
        color: 0xdfdedb, roughness: 0.25, metalness: 0.15, map: makeGridTexture('#e8e7e3', '#b8b5ae', 12)
      });
      const carpetMat = new THREE.MeshStandardMaterial({
        color: 0x4a4742, roughness: 0.85
      });
      const wallMat = new THREE.MeshStandardMaterial({
        color: 0xf5f3ee, roughness: 0.75
      });
      const exteriorBrickMat = new THREE.MeshStandardMaterial({
        color: 0x8b3a2b, roughness: 0.8, map: makeGridTexture('#8b3a2b', '#5c2217', 24)
      });
      const ceilingMat = new THREE.MeshStandardMaterial({
        color: 0x222428, roughness: 0.9, transparent: true, opacity: 0.98
      });
      this.ceilingMat = ceilingMat;
      const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff, transparent: true, opacity: 0.25, roughness: 0.1, transmission: 0.9
      });
      const goldAccentMat = new THREE.MeshStandardMaterial({
        color: 0xc9a86a, roughness: 0.3, metalness: 0.8
      });

      // --- 1. MAIN FLOOR (Ground Level: y = 0) ---
      // Living Room Floor
      const livingFloor = new THREE.Mesh(new THREE.PlaneGeometry(12, 10), woodFloorMat);
      livingFloor.rotation.x = -Math.PI / 2;
      livingFloor.position.set(2, 0, 2);
      livingFloor.receiveShadow = true;
      this.houseGroup.add(livingFloor);

      // Kitchen & Dining Floor (Tile)
      const kitchenFloor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), tileFloorMat);
      kitchenFloor.rotation.x = -Math.PI / 2;
      kitchenFloor.position.set(-6, 0, 2);
      kitchenFloor.receiveShadow = true;
      this.houseGroup.add(kitchenFloor);

      // Primary Suite & Bed Wings Floor (Wood)
      const bedroomFloor = new THREE.Mesh(new THREE.PlaneGeometry(8, 10), woodFloorMat);
      bedroomFloor.rotation.x = -Math.PI / 2;
      bedroomFloor.position.set(7, 0, -2);
      bedroomFloor.receiveShadow = true;
      this.houseGroup.add(bedroomFloor);

      // Outdoor Stamped Patio & Lawn
      const patioFloor = new THREE.Mesh(new THREE.PlaneGeometry(14, 8), tileFloorMat);
      patioFloor.rotation.x = -Math.PI / 2;
      patioFloor.position.set(-4, -0.05, -8);
      patioFloor.receiveShadow = true;
      this.houseGroup.add(patioFloor);

      const lawnGeo = new THREE.PlaneGeometry(50, 50);
      const lawnMat = new THREE.MeshStandardMaterial({ color: 0x2d4c2d, roughness: 0.9 });
      const lawn = new THREE.Mesh(lawnGeo, lawnMat);
      lawn.rotation.x = -Math.PI / 2;
      lawn.position.set(0, -0.1, 0);
      lawn.receiveShadow = true;
      this.houseGroup.add(lawn);

      // --- 2. LOWER LEVEL (Basement: y = -3.2) ---
      this.lowerLevelGroup = new THREE.Group();
      const lowerFloor = new THREE.Mesh(new THREE.PlaneGeometry(18, 14), carpetMat);
      lowerFloor.rotation.x = -Math.PI / 2;
      lowerFloor.position.set(0, -3.2, 2);
      lowerFloor.receiveShadow = true;
      this.lowerLevelGroup.add(lowerFloor);

      // Lower Level Walls
      const lowerWallGeo = new THREE.BoxGeometry(18, 3.2, 0.4);
      const lowerBackWall = new THREE.Mesh(lowerWallGeo, wallMat);
      lowerBackWall.position.set(0, -1.6, -5);
      this.lowerLevelGroup.add(lowerBackWall);

      // Wet Bar Counter
      const barCounter = new THREE.Mesh(new THREE.BoxGeometry(4.5, 1.1, 1.2), woodFloorMat);
      barCounter.position.set(-4, -2.65, 3.5);
      barCounter.castShadow = true;
      this.lowerLevelGroup.add(barCounter);

      this.houseGroup.add(this.lowerLevelGroup);

      // --- 3. ARCHITECTURAL WALLS & CORRIDORS ---
      const createWall = (w, h, d, x, y, z, mat = wallMat) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        mesh.position.set(x, y, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.houseGroup.add(mesh);
        return mesh;
      };

      // Exterior Perimeter Walls (Main Floor: h = 3.2, y = 1.6)
      createWall(22, 3.2, 0.4, 0, 1.6, 7.2, exteriorBrickMat); // Front Wall
      createWall(22, 3.2, 0.4, 0, 1.6, -5.2, exteriorBrickMat); // Back Wall
      createWall(0.4, 3.2, 12.8, -11, 1.6, 1, exteriorBrickMat); // Left Wall
      createWall(0.4, 3.2, 12.8, 11, 1.6, 1, exteriorBrickMat);  // Right Wall

      // Interior Partitions
      createWall(0.3, 3.2, 7, -1, 1.6, 0.5); // Divider between Living & Kitchen
      createWall(6, 3.2, 0.3, 6, 1.6, -1);   // Divider between Living & Primary Bed

      // Roof / Ceiling (Removable in Dollhouse & Blueprint)
      this.roofMesh = new THREE.Mesh(new THREE.BoxGeometry(23, 0.3, 14), ceilingMat);
      this.roofMesh.position.set(0, 3.3, 1);
      this.houseGroup.add(this.roofMesh);

      // --- 4. SIGNATURE FURNITURE & INTERIOR HIGHLIGHTS ---
      // Painted Brick Hearth & Fireplace (Living Room)
      const hearthBase = new THREE.Mesh(new THREE.BoxGeometry(4, 2.6, 1), exteriorBrickMat);
      hearthBase.position.set(3, 1.3, 6.6);
      this.houseGroup.add(hearthBase);

      const mantel = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.2, 1.2), woodFloorMat);
      mantel.position.set(3, 2.3, 6.6);
      this.houseGroup.add(mantel);

      // Living Room Sofa & Rug
      const rug = new THREE.Mesh(new THREE.PlaneGeometry(5, 4), carpetMat);
      rug.rotation.x = -Math.PI / 2;
      rug.position.set(2.5, 0.02, 2.5);
      this.houseGroup.add(rug);

      const sofaMat = new THREE.MeshStandardMaterial({ color: 0x3d434a, roughness: 0.7 });
      const sofa = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.85, 1.4), sofaMat);
      sofa.position.set(2.5, 0.42, 1.2);
      sofa.castShadow = true;
      this.houseGroup.add(sofa);

      // Kitchen Waterfall Island (Quartz)
      const islandMat = new THREE.MeshStandardMaterial({ color: 0xf0efe9, roughness: 0.15, metalness: 0.1 });
      const island = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.05, 1.8), islandMat);
      island.position.set(-5, 0.52, -0.5);
      island.castShadow = true;
      this.houseGroup.add(island);

      // Kitchen Barstools
      for (let i = -1.2; i <= 1.2; i += 1.2) {
        const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.75, 16), goldAccentMat);
        stool.position.set(-5 + i, 0.37, 0.8);
        stool.castShadow = true;
        this.houseGroup.add(stool);
      }

      // Primary Suite Bed
      const bed = new THREE.Mesh(new THREE.BoxGeometry(3, 0.9, 3.4), sofaMat);
      bed.position.set(7.5, 0.45, -2.5);
      bed.castShadow = true;
      this.houseGroup.add(bed);

      // Windows (Glass Openings)
      const frontWindow = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), glassMat);
      frontWindow.position.set(3, 1.6, 7.05);
      this.houseGroup.add(frontWindow);

      const patioSlider = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 2.4), glassMat);
      patioSlider.position.set(-5, 1.3, -5.05);
      this.houseGroup.add(patioSlider);
    }

    createNodeRings() {
      this.nodeGroup = new THREE.Group();
      this.scene.add(this.nodeGroup);

      const strip = document.getElementById('spatialNodesStrip');
      strip.innerHTML = '';

      this.nodes.forEach((node, index) => {
        // Glowing Floor Target Ring
        const ringGeo = new THREE.RingGeometry(0.55, 0.75, 32);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xc9a86a,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.85
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.copy(node.pos);
        ring.position.y = (node.pos.y > 0 ? 0.04 : -3.16);
        ring.userData = { nodeIndex: index, name: node.name };

        // Outer Pulsing Circle
        const pulseGeo = new THREE.RingGeometry(0.75, 0.82, 32);
        const pulseMat = new THREE.MeshBasicMaterial({
          color: 0xe6d3a3,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.4
        });
        const pulse = new THREE.Mesh(pulseGeo, pulseMat);
        pulse.rotation.x = -Math.PI / 2;
        pulse.position.copy(ring.position);
        pulse.position.y += 0.005;

        const nodeObj = new THREE.Group();
        nodeObj.add(ring);
        nodeObj.add(pulse);
        nodeObj.userData = { pulse, ring, nodeIndex: index };

        this.nodeGroup.add(nodeObj);
        this.nodeRings.push(nodeObj);
        this.interactiveTargets.push(ring);

        // Strip Button
        const btn = document.createElement('button');
        btn.className = `node-bubble-btn ${index === 0 ? 'is-active' : ''}`;
        btn.dataset.index = String(index);
        btn.innerHTML = `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:currentColor"></span><span>${node.name}</span>`;
        btn.addEventListener('click', () => this.jumpToNode(index));
        strip.appendChild(btn);
      });
    }

    createDollhousePins() {
      this.pinsGroup = new THREE.Group();
      this.scene.add(this.pinsGroup);

      const pinLocations = [
        { name: 'Great Living Room', pos: new THREE.Vector3(2.5, 3.8, 2), targetNode: 1 },
        { name: 'Chef Kitchen Island', pos: new THREE.Vector3(-5, 3.8, -0.5), targetNode: 2 },
        { name: 'Primary Bedroom Suite', pos: new THREE.Vector3(7.5, 3.8, -2.5), targetNode: 3 },
        { name: 'Finished Lower Level Rec', pos: new THREE.Vector3(-3.5, 0.5, 3), targetNode: 4 },
        { name: 'Stamped Backyard Patio', pos: new THREE.Vector3(-5, 3.8, -8), targetNode: 5 }
      ];

      pinLocations.forEach(loc => {
        const pinHead = new THREE.Mesh(
          new THREE.SphereGeometry(0.35, 16, 16),
          new THREE.MeshStandardMaterial({ color: 0xc9a86a, metalness: 0.8, roughness: 0.2 })
        );
        const pinStick = new THREE.Mesh(
          new THREE.CylinderGeometry(0.04, 0.04, 1.2),
          new THREE.MeshBasicMaterial({ color: 0xffffff })
        );
        pinStick.position.y = -0.6;
        pinHead.add(pinStick);
        pinHead.position.copy(loc.pos);
        pinHead.userData = { targetNode: loc.targetNode, name: loc.name, isPin: true };

        this.pinsGroup.add(pinHead);
        this.roomPins.push(pinHead);
        this.interactiveTargets.push(pinHead);
      });
    }

    setupInputListeners() {
      const vp = document.getElementById('spatialViewport');

      // Mode Switcher Buttons
      const modeButtons = this.container.querySelectorAll('.spatial-mode-btn');
      modeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          modeButtons.forEach(b => b.classList.remove('is-active'));
          btn.classList.add('is-active');
          this.setMode(btn.dataset.mode);
        });
      });

      // Actions
      document.getElementById('btnVisionPro').addEventListener('click', () => this.toggleVisionPro());
      document.getElementById('btnResetView').addEventListener('click', () => this.resetView());
      document.getElementById('btnFullscreen').addEventListener('click', () => this.toggleFullscreen());
      
      const audioBtn = document.getElementById('btnAudioToggle');
      audioBtn.addEventListener('click', () => {
        this.audio.enabled = !this.audio.enabled;
        audioBtn.classList.toggle('is-active', this.audio.enabled);
        if (this.audio.enabled) this.audio.init();
      });

      const btnExitDrone = document.getElementById('btnExitDrone');
      if (btnExitDrone) {
        btnExitDrone.addEventListener('click', () => {
          const btn6dof = this.container.querySelector('[data-mode="6dof"]');
          if (btn6dof) btn6dof.click();
        });
      }

      // Level Toggles
      const levelButtons = this.container.querySelectorAll('.level-btn');
      levelButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          levelButtons.forEach(b => b.classList.remove('is-active'));
          btn.classList.add('is-active');
          this.setLevel(btn.dataset.level);
        });
      });

      // Keyboard Listeners (6DoF)
      window.addEventListener('keydown', e => this.onKeyDown(e));
      window.addEventListener('keyup', e => this.onKeyUp(e));

      // Pointer / Mouse Drag Look (6DoF & Node)
      let isDragging = false;
      let lastX = 0, lastY = 0;

      vp.addEventListener('mousedown', e => {
        if (e.target.closest('.spatial-nav') || e.target.closest('.spatial-nodes-strip')) return;
        this.audio.init();
        isDragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        this.checkRaycastClick(e);
      });

      window.addEventListener('mousemove', e => {
        if (!isDragging) return;
        if (this.currentMode === '6dof' || this.currentMode === 'nodes') {
          const dx = e.clientX - lastX;
          const dy = e.clientY - lastY;
          lastX = e.clientX;
          lastY = e.clientY;

          // 3 Rotational Axes: Yaw, Pitch, Roll
          this.cameraRot.yaw -= dx * 0.003;
          this.cameraRot.pitch -= dy * 0.003;
          this.cameraRot.pitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, this.cameraRot.pitch));

          // Subtle roll banking when strafing
          this.cameraRot.roll = -this.moveState.left * 0.03 + this.moveState.right * 0.03;
        }
      });

      window.addEventListener('mouseup', () => { isDragging = false; });

      // Minimap Click (Teleport to Floor Plan)
      document.getElementById('spatialMinimap').addEventListener('click', () => {
        const floorBtn = this.container.querySelector('[data-mode="floorplan"]');
        if (floorBtn) floorBtn.click();
      });

      // Mobile Touch Joysticks
      this.setupMobileTouch();
    }

    setupMobileTouch() {
      const stickMove = document.getElementById('stickMove');
      const knobMove = document.getElementById('knobMove');
      const stickLook = document.getElementById('stickLook');
      const knobLook = document.getElementById('knobLook');

      const handleJoystick = (element, knob, onMove) => {
        let touchId = null;
        let rect = null;

        element.addEventListener('touchstart', e => {
          this.audio.init();
          const t = e.changedTouches[0];
          touchId = t.identifier;
          rect = element.getBoundingClientRect();
          e.preventDefault();
        }, { passive: false });

        element.addEventListener('touchmove', e => {
          for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            if (t.identifier === touchId) {
              const cx = rect.left + rect.width / 2;
              const cy = rect.top + rect.height / 2;
              let dx = t.clientX - cx;
              let dy = t.clientY - cy;
              const dist = Math.hypot(dx, dy);
              const maxDist = 30;
              if (dist > maxDist) {
                dx = (dx / dist) * maxDist;
                dy = (dy / dist) * maxDist;
              }
              knob.style.transform = `translate(${dx}px, ${dy}px)`;
              onMove(dx / maxDist, dy / maxDist);
              e.preventDefault();
              break;
            }
          }
        }, { passive: false });

        const reset = () => {
          touchId = null;
          knob.style.transform = 'none';
          onMove(0, 0);
        };
        element.addEventListener('touchend', reset);
        element.addEventListener('touchcancel', reset);
      };

      handleJoystick(stickMove, knobMove, (nx, ny) => {
        this.moveState.left = nx < -0.2 ? -nx : 0;
        this.moveState.right = nx > 0.2 ? nx : 0;
        this.moveState.forward = ny < -0.2 ? -ny : 0;
        this.moveState.backward = ny > 0.2 ? ny : 0;
      });

      handleJoystick(stickLook, knobLook, (nx, ny) => {
        if (this.currentMode === '6dof' || this.currentMode === 'nodes') {
          this.cameraRot.yaw -= nx * 0.04;
          this.cameraRot.pitch -= ny * 0.04;
          this.cameraRot.pitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, this.cameraRot.pitch));
        }
      });

      document.getElementById('btnElevUp').addEventListener('click', () => {
        this.cameraPos.y = Math.min(2.4, this.cameraPos.y + 0.3);
      });
      document.getElementById('btnElevDown').addEventListener('click', () => {
        this.cameraPos.y = Math.max(0.7, this.cameraPos.y - 0.3);
      });
    }

    onKeyDown(e) {
      this.audio.init();
      switch (e.code) {
        case 'KeyW': case 'ArrowUp': this.moveState.forward = 1; break;
        case 'KeyS': case 'ArrowDown': this.moveState.backward = 1; break;
        case 'KeyA': case 'ArrowLeft': this.moveState.left = 1; break;
        case 'KeyD': case 'ArrowRight': this.moveState.right = 1; break;
        case 'Space': // Stand / Elevate
          e.preventDefault();
          this.cameraPos.y = Math.min(2.4, this.cameraPos.y + 0.3);
          break;
        case 'KeyC': // Crouch
          e.preventDefault();
          this.cameraPos.y = Math.max(0.7, this.cameraPos.y - 0.3);
          break;
        case 'ShiftLeft': case 'ShiftRight':
          this.moveState.sprint = true;
          break;
      }
    }

    onKeyUp(e) {
      switch (e.code) {
        case 'KeyW': case 'ArrowUp': this.moveState.forward = 0; break;
        case 'KeyS': case 'ArrowDown': this.moveState.backward = 0; break;
        case 'KeyA': case 'ArrowLeft': this.moveState.left = 0; break;
        case 'KeyD': case 'ArrowRight': this.moveState.right = 0; break;
        case 'ShiftLeft': case 'ShiftRight':
          this.moveState.sprint = false;
          break;
      }
    }

    checkRaycastClick(event) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.mouse, this.camera);
      const intersects = this.raycaster.intersectObjects(this.interactiveTargets, true);

      if (intersects.length > 0) {
        let hit = intersects[0].object;
        while (hit && !hit.userData.nodeIndex && !hit.userData.targetNode && hit.parent !== this.scene) {
          hit = hit.parent;
        }

        if (hit && hit.userData.nodeIndex !== undefined) {
          this.jumpToNode(hit.userData.nodeIndex);
        } else if (hit && hit.userData.targetNode !== undefined) {
          this.jumpToNode(hit.userData.targetNode);
        }
      }
    }

    setMode(mode) {
      this.currentMode = mode;
      this.isVisible = true;
      if (!this.isLoopRunning) {
        this.lastTime = performance.now();
        this.animate();
      }

      const levelsEl = document.getElementById('spatialLevels');
      const nodesStripEl = document.getElementById('spatialNodesStrip');
      const reticleEl = document.getElementById('spatialReticle');
      const promptEl = document.getElementById('reticleInspect');

      // Reset Visibility defaults
      levelsEl.classList.remove('is-visible');
      nodesStripEl.classList.remove('is-visible');
      reticleEl.style.display = 'grid';
      this.controls.enabled = false;
      this.roofMesh.visible = true;

      // Track analytics
      try {
        fetch('/api/analytics/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: `${mode}_launch`, propertyId: 'fox-plains' })
        });
      } catch (_) {}

      if (mode === '6dof') {
        promptEl.textContent = '6DoF Active · WASD to Walk · Mouse to Look · Space/C to Elevate';
        this.nodeGroup.visible = false;
        this.pinsGroup.visible = false;
      } else if (mode === 'nodes') {
        promptEl.textContent = 'Click Glowing Floor Rings to Jump Between 360° Capture Bubbles';
        nodesStripEl.classList.add('is-visible');
        this.nodeGroup.visible = true;
        this.pinsGroup.visible = false;
        this.jumpToNode(this.activeNodeIndex);
      } else if (mode === 'dollhouse') {
        promptEl.textContent = 'Grab, Rotate & Tilt the 3D Miniature Model · Click Pins to Enter Rooms';
        levelsEl.classList.add('is-visible');
        reticleEl.style.display = 'none';
        this.roofMesh.visible = false;
        this.nodeGroup.visible = false;
        this.pinsGroup.visible = true;
        this.controls.enabled = true;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
        this.animateCameraTo(this.dollhouseCamPos, new THREE.Vector3(0, 0, 0));
      } else if (mode === 'floorplan') {
        promptEl.textContent = 'Top-Down Architectural Blueprint · Click Rooms to Teleport';
        levelsEl.classList.add('is-visible');
        reticleEl.style.display = 'none';
        this.roofMesh.visible = false;
        this.nodeGroup.visible = true;
        this.pinsGroup.visible = true;
        this.controls.enabled = true;
        this.animateCameraTo(this.floorplanCamPos, new THREE.Vector3(0, 0, 0));
      } else if (mode === 'drone') {
        promptEl.textContent = 'Autonomous 3D Drone Active · Spline Flight & Exact Interior Overlays';
        reticleEl.style.display = 'none';
        this.nodeGroup.visible = false;
        this.pinsGroup.visible = false;
      }

      // Handle Drone Overlay Container & Sub-controls
      const droneOverlay = document.getElementById('spatialDroneOverlay');
      const droneIframe = document.getElementById('spatialDroneIframe');
      const minimapEl = document.getElementById('spatialMinimap');
      const teleEl = document.getElementById('spatialTelemetry');
      const helpEl = document.getElementById('spatialHelpBar');
      const mobEl = document.getElementById('spatialMobileControls');

      if (mode === 'drone') {
        if (droneOverlay) droneOverlay.style.display = 'flex';
        if (minimapEl) minimapEl.style.display = 'none';
        if (teleEl) teleEl.style.display = 'none';
        if (helpEl) helpEl.style.display = 'none';
        if (mobEl) mobEl.style.display = 'none';

        if (droneIframe) {
          const targetDroneSrc = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
            ? 'http://localhost:5173/'
            : '/drone/';
          if (!droneIframe.src || droneIframe.src === 'about:blank' || (!droneIframe.src.includes('5173') && !droneIframe.src.includes('/drone/'))) {
            droneIframe.src = targetDroneSrc;
          }
        }
      } else {
        if (droneOverlay) droneOverlay.style.display = 'none';
        if (minimapEl) minimapEl.style.display = 'block';
        if (teleEl) teleEl.style.display = 'flex';
        if (helpEl) helpEl.style.display = 'flex';
        if (mobEl) mobEl.style.display = 'flex';
      }

      // Dispatch event to sync external viewpoint cards
      try {
        window.dispatchEvent(new CustomEvent('spatialModeChanged', { detail: { mode } }));
      } catch (_) {}
    }

    setLevel(level) {
      this.activeLevel = level;
      if (level === 'all') {
        this.houseGroup.visible = true;
        this.lowerLevelGroup.visible = true;
      } else if (level === 'main') {
        this.houseGroup.visible = true;
        this.lowerLevelGroup.visible = false;
      } else if (level === 'lower') {
        this.lowerLevelGroup.visible = true;
      }
    }

    jumpToNode(index) {
      if (index < 0 || index >= this.nodes.length) return;
      this.activeNodeIndex = index;
      const targetNode = this.nodes[index];

      // Update Node Strip Buttons
      const stripButtons = this.container.querySelectorAll('.node-bubble-btn');
      stripButtons.forEach((b, i) => b.classList.toggle('is-active', i === index));

      // Audio
      this.audio.playTeleport();

      // Smooth Camera Glide
      this.animateCameraTo(targetNode.pos, null, () => {
        this.cameraPos.copy(targetNode.pos);
        if (this.currentMode === 'dollhouse' || this.currentMode === 'floorplan') {
          // If in dollhouse/blueprint and user clicks a node, switch into Node Walkthrough!
          const nodeBtn = this.container.querySelector('[data-mode="nodes"]');
          if (nodeBtn) nodeBtn.click();
        }
      });
    }

    animateCameraTo(targetPos, targetLookAt, onComplete) {
      this.isTransitioning = true;
      const startPos = this.camera.position.clone();
      const startTime = performance.now();
      const duration = 1200;

      const step = now => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);
        // Smooth Cubic Easing
        const ease = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;

        this.camera.position.lerpVectors(startPos, targetPos, ease);
        if (targetLookAt && this.controls.enabled) {
          this.controls.target.lerp(targetLookAt, 0.1);
        }

        if (progress < 1) {
          requestAnimationFrame(step);
        } else {
          this.isTransitioning = false;
          if (onComplete) onComplete();
        }
      };
      requestAnimationFrame(step);
    }

    toggleVisionPro() {
      this.isVisionPro = !this.isVisionPro;
      const overlay = document.getElementById('visionProOverlay');
      const btn = document.getElementById('btnVisionPro');
      overlay.classList.toggle('is-active', this.isVisionPro);
      btn.classList.toggle('is-active', this.isVisionPro);
    }

    resetView() {
      if (this.currentMode === '6dof' || this.currentMode === 'nodes') {
        this.cameraPos.set(0, 1.6, 7);
        this.cameraRot = { yaw: 0, pitch: 0, roll: 0 };
      } else if (this.currentMode === 'dollhouse') {
        this.animateCameraTo(this.dollhouseCamPos, new THREE.Vector3(0, 0, 0));
      } else if (this.currentMode === 'floorplan') {
        this.animateCameraTo(this.floorplanCamPos, new THREE.Vector3(0, 0, 0));
      }
    }

    toggleFullscreen() {
      const suite = this.container.querySelector('.spatial-suite');
      if (!document.fullscreenElement) {
        suite.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    }

    onResize() {
      const width = this.container.clientWidth;
      const height = document.fullscreenElement ? window.innerHeight - 60 : 640;
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
    }

    update6DoF(delta) {
      if (this.isTransitioning) return;

      const speed = this.moveState.sprint ? 5.5 : 2.8;
      const forwardDir = new THREE.Vector3(
        -Math.sin(this.cameraRot.yaw),
        0,
        -Math.cos(this.cameraRot.yaw)
      ).normalize();

      const rightDir = new THREE.Vector3(
        Math.cos(this.cameraRot.yaw),
        0,
        -Math.sin(this.cameraRot.yaw)
      ).normalize();

      const moveVec = new THREE.Vector3();
      if (this.moveState.forward) moveVec.add(forwardDir.clone().multiplyScalar(this.moveState.forward));
      if (this.moveState.backward) moveVec.add(forwardDir.clone().multiplyScalar(-this.moveState.backward));
      if (this.moveState.right) moveVec.add(rightDir.clone().multiplyScalar(this.moveState.right));
      if (this.moveState.left) moveVec.add(rightDir.clone().multiplyScalar(-this.moveState.left));

      if (moveVec.lengthSq() > 0) {
        moveVec.normalize().multiplyScalar(speed * delta);
        this.cameraPos.add(moveVec);

        // Footstep Audio
        this.stepTimer += delta * (this.moveState.sprint ? 1.6 : 1.0);
        if (this.stepTimer > 0.45) {
          this.stepTimer = 0;
          this.audio.playStep();
        }
      }

      // Room Boundary Collision Protection (Keep inside lot)
      this.cameraPos.x = Math.max(-10, Math.min(10, this.cameraPos.x));
      this.cameraPos.z = Math.max(-12, Math.min(10, this.cameraPos.z));

      // Update Camera Transform
      this.camera.position.copy(this.cameraPos);
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.y = this.cameraRot.yaw;
      this.camera.rotation.x = this.cameraRot.pitch;
      this.camera.rotation.z = this.cameraRot.roll;

      // Update Telemetry HUD
      this.updateTelemetry();
    }

    updateTelemetry() {
      // Determine Room Zone
      let zone = 'Front Entry Foyer';
      const x = this.cameraPos.x, z = this.cameraPos.z, y = this.cameraPos.y;

      if (y < -1) {
        zone = 'Finished Lower Level Rec & Bar';
      } else if (z < -5) {
        zone = 'Stamped Backyard Patio & Grounds';
      } else if (x < -2) {
        zone = 'Chef Kitchen & Dining Nook';
      } else if (x > 5) {
        zone = 'Primary Bedroom Sanctuary';
      } else {
        zone = 'Great Living Room & Fireplace';
      }

      document.getElementById('tZone').textContent = zone;
      document.getElementById('tCoords').textContent = `X: ${x.toFixed(1)} Y: ${y.toFixed(1)} Z: ${z.toFixed(1)}`;
      document.getElementById('tAxes').textContent = `Pitch: ${(this.cameraRot.pitch * 57.3).toFixed(0)}° · Yaw: ${(this.cameraRot.yaw * 57.3).toFixed(0)}° · Roll: ${(this.cameraRot.roll * 57.3).toFixed(0)}°`;
      document.getElementById('tElev').textContent = `${y.toFixed(2)} m ${y < 1.2 ? '(Crouched)' : y > 2.0 ? '(Elevated)' : '(Eye Level)'}`;

      // Update Minimap Beacon & Cone
      const beacon = document.getElementById('minimapBeacon');
      const cone = document.getElementById('beaconCone');
      if (beacon && cone) {
        // Map X: -10..10 to 10%..90%, Z: -12..10 to 10%..90%
        const mapX = 50 + (x / 20) * 80;
        const mapY = 50 + (z / 20) * 80;
        beacon.style.left = `${Math.max(5, Math.min(95, mapX))}%`;
        beacon.style.top = `${Math.max(5, Math.min(95, mapY))}%`;
        cone.style.transform = `translate(-12px, -24px) rotate(${this.cameraRot.yaw}rad)`;
      }
    }

    animate() {
      if (!this.isVisible) {
        this.isLoopRunning = false;
        return;
      }
      this.isLoopRunning = true;
      requestAnimationFrame(() => this.animate());

      const now = performance.now();
      const delta = Math.min((now - this.lastTime) / 1000, 0.1);
      this.lastTime = now;

      // Mode-Specific Update
      if (this.currentMode === 'drone') {
        return;
      } else if (this.currentMode === '6dof') {
        this.update6DoF(delta);
      } else if (this.currentMode === 'nodes') {
        // In Node mode, user looks around 360 from fixed bubble
        this.camera.position.copy(this.cameraPos);
        this.camera.rotation.order = 'YXZ';
        this.camera.rotation.y = this.cameraRot.yaw;
        this.camera.rotation.x = this.cameraRot.pitch;

        // Animate pulse on floor rings
        this.nodeRings.forEach(nr => {
          const p = nr.userData.pulse;
          if (p) {
            const s = 1 + 0.15 * Math.sin(now * 0.004);
            p.scale.set(s, s, 1);
          }
        });
        this.updateTelemetry();
      } else if (this.currentMode === 'dollhouse' || this.currentMode === 'floorplan') {
        this.controls.update();

        // Animate floating room pins
        this.roomPins.forEach((pin, i) => {
          pin.position.y += Math.sin(now * 0.003 + i) * 0.002;
        });
      }

      this.renderer.render(this.scene, this.camera);
    }
  }

  // Expose global class and mount hook
  window.SpatialViewer = SpatialViewer;

  window.initSpatialViewer = function() {
    if (window.spatialViewerInstance) return window.spatialViewerInstance;
    if (window.THREE && window.THREE.OrbitControls && document.getElementById('spatialViewerMount')) {
      window.spatialViewerInstance = new SpatialViewer('spatialViewerMount');
      return window.spatialViewerInstance;
    }
    return null;
  };

  // Auto-mount whether loaded synchronously or dynamically
  const tryAutoInit = () => {
    if (!window.initSpatialViewer()) {
      setTimeout(tryAutoInit, 150);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryAutoInit);
  } else {
    tryAutoInit();
  }
})();
