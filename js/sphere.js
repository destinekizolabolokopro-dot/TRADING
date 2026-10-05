'use strict';
/**
 * LA SPHÈRE DE CHANDELIERS — js/sphere.js
 *
 * Composant `<candle-sphere>` repris TEL QUEL du handoff Méridien v2, à
 * l'en-tête près. C'est un canvas 2D autonome : aucune dépendance, il gère
 * lui-même le ratio de pixels, le redimensionnement et `prefers-reduced-
 * motion` (image fixe, pas d'animation).
 *
 * Attributs : mode (« Chandeliers » | « Courbes »), glow 0-1, animate,
 * up, down, accent.
 *
 * Il ne porte AUCUNE donnée de marché : les étiquettes qui tournent sur les
 * orbites sont décoratives et écrites en dur dans le composant. Ne jamais les
 * lire comme un prix — ce serait le seul chiffre faux de la page.
 */
(function () {
  const TAU = Math.PI * 2;
  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + Math.max(0, Math.min(1, a)) + ")";
  }
  function rotY(v, a) { const c = Math.cos(a), s = Math.sin(a); return [v[0] * c - v[2] * s, v[1], v[0] * s + v[2] * c]; }
  function rotX(v, a) { const c = Math.cos(a), s = Math.sin(a); return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c]; }
  function rotZ(v, a) { const c = Math.cos(a), s = Math.sin(a); return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]]; }
  function wave(x) { return Math.sin(x) * 0.55 + Math.sin(x * 2.3 + 1.7) * 0.3 + Math.sin(x * 5.1 + 0.4) * 0.15; }

  class CandleSphere extends HTMLElement {
    connectedCallback() {
      if (this._on) return;
      this._on = true;
      this.style.display = "block";
      this.style.position = "absolute";
      this.style.inset = "0";
      this.canvas = document.createElement("canvas");
      this.canvas.style.cssText = "display:block;position:absolute;inset:0;width:100%;height:100%;";
      this.appendChild(this.canvas);
      const N = 560, ga = Math.PI * (3 - Math.sqrt(5));
      this.pts = [];
      for (let i = 0; i < N; i++) {
        const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(Math.max(0, 1 - y * y)), th = ga * i;
        this.pts.push({ v: [Math.cos(th) * r, y, Math.sin(th) * r], ph: (i * 2.71) % TAU, f: 0.6 + ((i * 37) % 17) / 14 });
      }
      this._ro = new ResizeObserver(() => { this._dirty = true; });
      this._ro.observe(this);
      this._dirty = true;
      this.t0 = performance.now();
      this._reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const loop = now => {
        if (!this._on) return;
        this._raf = requestAnimationFrame(loop);
        const anim = this.getAttribute("animate") !== "false" && this.animate !== false && !this._reduce;
        if (!anim && this._drawn && !this._dirty) return;
        if (this._dirty) this.fit();
        this.draw(anim ? (now - this.t0) / 1000 : 4.2);
        this._drawn = true;
      };
      this._raf = requestAnimationFrame(loop);
    }
    disconnectedCallback() { this._on = false; cancelAnimationFrame(this._raf); this._ro && this._ro.disconnect(); }
    fit() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2), r = this.getBoundingClientRect();
      this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
      this.canvas.width = Math.round(this.w * dpr); this.canvas.height = Math.round(this.h * dpr);
      this.ctx = this.canvas.getContext("2d");
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._dirty = false;
    }
    opt(name, def) { const a = this.getAttribute(name); return a != null ? a : (this[name] != null ? this[name] : def); }

    draw(t) {
      const ctx = this.ctx; if (!ctx) return;
      const w = this.w, h = this.h, cx = w / 2, cy = h / 2;
      const R = Math.min(w, h) * 0.34;
      const A = this.opt("accent", "#b5abfc"), A2 = "#d2cefd", UP = this.opt("up", "#46e0a8"), DN = this.opt("down", "#ff6f91"), INK = "#e9e9ed";
      const glow = parseFloat(this.opt("glow", "0.8"));
      const mode = this.opt("mode", "Chandeliers");
      const spin = t * 0.16, tilt = -0.38;
      const P = v => rotX(rotY(v, spin), tilt);
      ctx.clearRect(0, 0, w, h);

      const bloom = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 1.9);
      bloom.addColorStop(0, rgba("#4c5397", 0.42 * glow));
      bloom.addColorStop(0.45, rgba("#262a60", 0.32 * glow));
      bloom.addColorStop(1, rgba("#161826", 0));
      ctx.fillStyle = bloom; ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.004, 0, TAU);
      const core = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
      core.addColorStop(0, rgba("#2b2741", 0.9)); core.addColorStop(1, rgba("#161826", 0.92));
      ctx.fillStyle = core; ctx.fill();
      ctx.restore();

      this.drawOrbits(ctx, t, cx, cy, R, A, A2, UP, glow, false);

      ctx.globalCompositeOperation = "lighter";
      if (mode === "Courbes") this.drawCurves(ctx, t, cx, cy, R, P, A, A2, UP, DN, glow);
      else this.drawCandles(ctx, t, cx, cy, R, P, UP, DN, A2, INK, glow);
      ctx.globalCompositeOperation = "source-over";

      const rim = ctx.createRadialGradient(cx, cy, R * 0.86, cx, cy, R * 1.08);
      rim.addColorStop(0, rgba(A, 0)); rim.addColorStop(0.62, rgba(A, 0.32 * glow)); rim.addColorStop(1, rgba(A, 0));
      ctx.fillStyle = rim; ctx.beginPath(); ctx.arc(cx, cy, R * 1.08, 0, TAU); ctx.fill();
      ctx.strokeStyle = rgba(A2, 0.35); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();

      this.drawOrbits(ctx, t, cx, cy, R, A, A2, UP, glow, true);
    }

    drawCandles(ctx, t, cx, cy, R, P, UP, DN, A2, INK, glow) {
      const k = R / 260;
      for (let i = 0; i < this.pts.length; i++) {
        const p = this.pts[i], q = P(p.v), z = q[2];
        const x = cx + q[0] * R, y = cy - q[1] * R;
        if (z <= 0.04) {
          ctx.fillStyle = rgba(INK, 0.05 + (z + 1) * 0.04);
          ctx.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
          continue;
        }
        const ph = t * p.f + p.ph, s = Math.sin(ph), up = Math.cos(ph) > 0;
        const col = up ? UP : DN;
        const edge = Math.sqrt(1 - Math.min(1, q[0] * q[0] + q[1] * q[1]));
        const sc = (0.45 + 0.55 * edge) * k;
        const bw = 3.2 * sc, bh = (5 + 9 * Math.abs(s)) * sc, wk = bh * (1.5 + 0.4 * Math.abs(Math.sin(ph * 1.7)));
        const a = 0.25 + 0.75 * z;
        ctx.fillStyle = rgba(col, a * 0.9);
        ctx.fillRect(x - 0.5 * sc, y - wk / 2, Math.max(0.8, sc), wk);
        if (up) { ctx.strokeStyle = rgba(col, a); ctx.lineWidth = Math.max(0.8, sc * 0.9); ctx.strokeRect(x - bw / 2, y - bh / 2, bw, bh); }
        else { ctx.fillRect(x - bw / 2, y - bh / 2, bw, bh); }
        if (glow > 0 && z > 0.55 && Math.abs(s) > 0.92) {
          ctx.fillStyle = rgba(col, 0.16 * glow * z);
          ctx.beginPath(); ctx.arc(x, y, 9 * sc + 6, 0, TAU); ctx.fill();
        }
      }
    }

    drawCurves(ctx, t, cx, cy, R, P, A, A2, UP, DN, glow) {
      const rings = 26, seg = 120;
      for (let r = 1; r < rings; r++) {
        const lat = -Math.PI / 2 + (r / rings) * Math.PI;
        const trend = wave(r * 1.3 + t * 0.35);
        const col = trend > 0.15 ? UP : trend < -0.15 ? DN : A2;
        let prev = null;
        for (let i = 0; i <= seg; i++) {
          const lon = (i / seg) * TAU;
          const amp = 1 + 0.055 * wave(lon * 4 + r * 0.9 - t * 1.4);
          const v = [Math.cos(lat) * Math.cos(lon) * amp, Math.sin(lat) * amp, Math.cos(lat) * Math.sin(lon) * amp];
          const q = P(v), x = cx + q[0] * R, y = cy - q[1] * R;
          if (prev) {
            const z = (q[2] + prev[2]) / 2;
            ctx.strokeStyle = z > 0 ? rgba(col, 0.2 + 0.7 * z) : rgba(A, 0.07);
            ctx.lineWidth = z > 0 ? 1 + z * 0.8 : 0.7;
            ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(x, y); ctx.stroke();
          }
          prev = [x, y, q[2]];
        }
      }
    }

    drawOrbits(ctx, t, cx, cy, R, A, A2, UP, glow, front) {
      const orbits = [
        // ⚠️ LA MAQUETTE ÉCRIVAIT ICI DES PRIX INVENTÉS — « BTC/USD 67 420 »
        // et « ES1! 5 642,25 » — qu'une onde faisait même osciller, comme un
        // vrai flux. Sur une page qui affiche de VRAIS prix à dix centimètres
        // de là, c'est le seul chiffre faux de l'écran, et rien ne le signale
        // au lecteur. Les étiquettes ne portent donc plus que des NOMS.
        // Le vrai prix, lui, est affiché par le panneau qui le reçoit.
        { r: 1.32, tx: 1.22, tz: 0.32, sp: 0.22, amp: 0.07, label: "NASDAQ 100", col: A2 },
        { r: 1.5, tx: 1.38, tz: -0.42, sp: -0.15, amp: 0.05, label: "S&P 500", col: UP }
      ];
      const seg = 200;
      orbits.forEach((o, oi) => {
        const pts = [];
        for (let i = 0; i <= seg; i++) {
          const th = (i / seg) * TAU;
          const rr = o.r * (1 + o.amp * wave(th * 9 + oi * 3 - t * 0.9));
          let v = [Math.cos(th) * rr, 0, Math.sin(th) * rr];
          v = rotZ(rotX(rotY(v, t * o.sp), o.tx), o.tz);
          pts.push([cx + v[0] * R, cy - v[1] * R, v[2]]);
        }
        ctx.lineWidth = 1.2;
        for (let i = 1; i < pts.length; i++) {
          const z = (pts[i][2] + pts[i - 1][2]) / 2;
          if ((z > 0) !== front) continue;
          const behind = !front && Math.hypot(pts[i][0] - cx, pts[i][1] - cy) < R;
          ctx.strokeStyle = rgba(o.col, behind ? 0.06 : front ? 0.35 + 0.4 * Math.min(1, z) : 0.18);
          ctx.beginPath(); ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke();
        }
        if (!front) return;
        // ⚠️ CORRECTION SUR LE COMPOSANT D'ORIGINE. `t` vaut (now - t0)/1000, et
        // l'horodatage que requestAnimationFrame passe à la première image peut
        // PRÉCÉDER l'instant d'initialisation : t est alors légèrement négatif,
        // le reste de la division est négatif, l'index l'est aussi, et pts[-1]
        // vaut undefined — « Cannot read properties of undefined (reading '2') »
        // à chaque chargement de page. La fraction est donc ramenée dans [0,1[
        // et l'index vérifié avant usage.
        const frac = (((t * 0.06 + oi * 0.5) % 1) + 1) % 1;
        const hp = pts[Math.min(seg, Math.floor(frac * seg))];
        if (!hp || hp[2] < 0) return;
        ctx.globalCompositeOperation = "lighter";
        const g = ctx.createRadialGradient(hp[0], hp[1], 0, hp[0], hp[1], 22);
        g.addColorStop(0, rgba(o.col, 0.6 * glow)); g.addColorStop(1, rgba(o.col, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(hp[0], hp[1], 22, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = "#f5f4ff"; ctx.beginPath(); ctx.arc(hp[0], hp[1], 2.8, 0, TAU); ctx.fill();
        const txt = o.label;
        ctx.font = "500 11px 'JetBrains Mono', ui-monospace, monospace";
        const tw = ctx.measureText(txt).width;
        const bx = hp[0] + 12, by = hp[1] - 11;
        ctx.fillStyle = "rgba(22,24,38,.86)";
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, tw + 16, 22, 11) : ctx.rect(bx, by, tw + 16, 22); ctx.fill();
        ctx.strokeStyle = rgba(o.col, 0.6); ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = "#e9e9ed"; ctx.textBaseline = "middle"; ctx.fillText(txt, bx + 8, by + 11.5);
      });
    }
  }
  if (!customElements.get("candle-sphere")) customElements.define("candle-sphere", CandleSphere);
})();
