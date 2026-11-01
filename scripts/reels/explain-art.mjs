/**
 * Art for "explain" Reels: a library of hand-drawn pictures that draw themselves and keep moving, and seven looks
 * (colours, moving backgrounds, how one step hands over to the next, where the words sit). Each Reel gets a look from
 * its hook, so two Reels rarely look alike, while the line style, type and calm pace stay ours.
 * Pictures use classes, not colours: .d = a line that draws itself, .a = accent line, .af = accent fill, .k = ink fill.
 */

const fig = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><circle class="d" pathLength="1" cx="0" cy="0" r="16"/>
  <path class="d" pathLength="1" d="M0 16 L0 70 M0 34 L-26 58 M0 34 L26 58 M0 70 L-20 108 M0 70 L20 108"/></g>`;
const go = (attrs) => `<animate begin="indefinite" class="go" ${attrs}/>`;
const goT = (attrs) => `<animateTransform begin="indefinite" class="go" ${attrs}/>`;

export const DRAW = {
  wave: () => `<path class="d a" pathLength="1" stroke-width="9" d="M20 250 C 110 250, 140 90, 200 90 S 290 250, 380 250"/>
    <path class="d" pathLength="1" stroke-width="4" d="M20 270 L380 270"/>
    <g class="mover"><animateMotion begin="indefinite" class="go" dur="4.5s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines=".45 .05 .55 .95" path="M20 250 C 110 250, 140 90, 200 90 S 290 250, 380 250"/>${fig(0, -112)}</g>`,
  alarm: () => `<circle class="d" pathLength="1" cx="200" cy="150" r="80"/><circle class="af" cx="200" cy="150" r="16"/>
    <g><path class="d a" pathLength="1" d="M90 70 L55 40 M310 70 L345 40 M80 150 L35 150 M320 150 L365 150 M90 230 L55 260 M310 230 L345 260"/>
    ${go('attributeName="opacity" values="1;0.15;1" dur="0.7s" repeatCount="4" fill="freeze"')}</g>`,
  ground: () => `${fig(200, 40)}<path class="d" pathLength="1" d="M60 170 L340 170"/>
    <g><path class="d a" pathLength="1" d="M170 190 L170 250 M155 235 L170 250 L185 235 M230 190 L230 250 M215 235 L230 250 L245 235"/>
    ${goT('attributeName="transform" type="translate" values="0 0;0 10;0 0" dur="1.6s" repeatCount="indefinite"')}</g>`,
  heart: () => `<g transform="translate(200 150)"><g><path class="d" pathLength="1" d="M0 95 C -150 10, -110 -90, -40 -76 C -12 -70, -3 -50, 0 -40 C 3 -50, 12 -70, 40 -76 C 110 -90, 150 10, 0 95 Z"/>
    ${goT('attributeName="transform" type="scale" values="1;1.12;1;1.12;1;1.06;1" keyTimes="0;.12;.24;.36;.6;.8;1" dur="3.6s" repeatCount="indefinite"')}</g></g>
    <path class="d a" pathLength="1" d="M10 260 L90 260 L110 230 L130 290 L150 260 L250 260 L265 245 L280 275 L295 260 L390 260"/>`,
  moon: () => `<path class="d a" pathLength="1" d="M300 40 C 240 55, 220 150, 290 195 C 220 215, 140 160, 155 90 C 165 45, 240 10, 300 40 Z"/>
    <rect class="d" pathLength="1" x="70" y="110" width="110" height="170" rx="18"/><text x="125" y="205" text-anchor="middle" font-family="Outfit" font-size="30" class="k fade" stroke="none">3:04</text>
    <g class="fade"><text x="320" y="250" font-family="Fraunces" font-size="34" class="af" stroke="none">z</text>${goT('attributeName="transform" type="translate" values="0 0;8 -14;0 0" dur="2.4s" repeatCount="indefinite"')}</g>`,
  breath: () => `<g transform="translate(200 150)"><circle class="d" pathLength="1" r="110" stroke-width="4"/><circle class="af" r="55" opacity=".85">
    ${go('attributeName="r" values="55;105;105;55" keyTimes="0;.4;.5;1" dur="8s" repeatCount="indefinite"')}</circle></g>`,
  five_things: () => `<path class="d" pathLength="1" d="M60 150 C 120 60, 280 60, 340 150 C 280 240, 120 240, 60 150 Z"/><circle class="af" cx="200" cy="150" r="34">
    ${goT('attributeName="transform" type="translate" values="0 0;-30 0;30 0;0 0" dur="4s" repeatCount="indefinite"')}</circle>
    ${[1, 2, 3, 4, 5].map((n, i) => `<text x="${50 + i * 75}" y="290" font-family="Fraunces" font-size="40" class="k pop" stroke="none" style="animation-delay:${0.5 + i * 0.35}s">${n}</text>`).join("")}`,
  bus: () => `<g><rect class="d" pathLength="1" x="40" y="60" width="300" height="150" rx="26"/><path class="d" pathLength="1" d="M60 100 L320 100 M40 170 L340 170"/>
    <circle class="d" pathLength="1" cx="110" cy="220" r="24"/><circle class="d" pathLength="1" cx="270" cy="220" r="24"/>
    ${goT('attributeName="transform" type="translate" values="0 0;0 3;0 0" dur=".5s" repeatCount="indefinite"')}</g>
    <path class="d a" pathLength="1" d="M20 260 L380 260"/><g class="a"><path class="d a" pathLength="1" d="M360 120 L392 120 M366 150 L398 150"/>${goT('attributeName="transform" type="translate" values="0 0;12 0;0 0" dur="1s" repeatCount="indefinite"')}</g>`,
  phone: () => `<rect class="d" pathLength="1" x="140" y="20" width="120" height="230" rx="22"/><path class="d" pathLength="1" d="M180 40 L220 40"/>
    <g><path class="d a" pathLength="1" d="M95 90 C 80 110, 80 150, 95 170 M70 70 C 45 105, 45 155, 70 190 M305 90 C 320 110, 320 150, 305 170 M330 70 C 355 105, 355 155, 330 190"/>
    ${go('attributeName="opacity" values="1;.2;1" dur="1.2s" repeatCount="indefinite"')}</g>
    <g>${goT('attributeName="transform" type="rotate" values="0 200 135;-4 200 135;4 200 135;0 200 135" dur=".6s" repeatCount="indefinite"')}<circle class="af" cx="200" cy="225" r="9"/></g>`,
  clock: () => `<circle class="d" pathLength="1" cx="200" cy="150" r="110"/>
    <g><path class="d" pathLength="1" stroke-width="8" d="M200 150 L200 80"/>${goT('attributeName="transform" type="rotate" from="0 200 150" to="360 200 150" dur="6s" repeatCount="indefinite"')}</g>
    <g><path class="d a" pathLength="1" stroke-width="8" d="M200 150 L250 150"/>${goT('attributeName="transform" type="rotate" from="0 200 150" to="360 200 150" dur="36s" repeatCount="indefinite"')}</g>
    <circle class="af" cx="200" cy="150" r="10"/>`,
  cup: () => `<path class="d" pathLength="1" d="M110 120 L290 120 L270 260 L130 260 Z"/><path class="d" pathLength="1" d="M290 150 C 345 150, 345 220, 282 220"/>
    ${[150, 200, 250].map((x, i) => `<path class="a steam" stroke-width="6" fill="none" d="M${x} 100 C ${x - 15} 80, ${x + 15} 60, ${x} 35" style="animation-delay:${i * 0.5}s"/>`).join("")}`,
  door: () => `<rect class="d" pathLength="1" x="120" y="30" width="160" height="240" rx="6"/><circle class="af" cx="250" cy="155" r="8"/>
    <g><path class="d a" pathLength="1" d="M120 30 L200 55 L200 290 L120 270 Z"/>${goT('attributeName="transform" type="skewY" values="0;-3;0" dur="3s" repeatCount="indefinite"')}</g>
    <path class="d" pathLength="1" d="M60 270 L340 270"/>${fig(330, 160, 0.9)}`,
  hands: () => `<g><path class="d" pathLength="1" d="M120 260 L120 150 C 120 130, 145 130, 145 150 L145 110 C 145 90, 170 90, 170 110 L170 100 C 170 80, 195 80, 195 100 L195 120 C 195 100, 220 100, 220 120 L220 200 C 220 240, 190 260, 160 260 Z"/>
    ${goT('attributeName="transform" type="translate" values="0 0;3 0;-3 0;2 0;0 0" dur=".35s" repeatCount="10" fill="freeze"')}</g>
    <path class="d a" pathLength="1" d="M250 150 C 280 120, 300 180, 330 150 C 350 130, 360 160, 380 150"/>`,
  two_people: () => `${fig(140, 70)}${fig(260, 70)}<path class="d a" pathLength="1" d="M166 128 C 190 115, 210 115, 234 128"/>
    <g class="fade"><path class="af" stroke="none" d="M200 20 C 185 0, 160 15, 200 45 C 240 15, 215 0, 200 20 Z"/>${goT('attributeName="transform" type="translate" values="0 0;0 -8;0 0" dur="2s" repeatCount="indefinite"')}</g>`,
  brain: () => `<path class="d" pathLength="1" d="M200 60 C 150 40, 100 70, 105 115 C 70 130, 75 190, 120 200 C 130 240, 190 250, 200 220 C 210 250, 270 240, 280 200 C 325 190, 330 130, 295 115 C 300 70, 250 40, 200 60 Z M200 60 L200 220"/>
    <g><path class="d a" pathLength="1" d="M140 120 C 160 100, 175 140, 190 120 M215 150 C 235 130, 250 170, 270 150"/>${go('attributeName="opacity" values="1;.3;1" dur="1.5s" repeatCount="indefinite"')}</g>
    ${[0, 1, 2].map((i) => `<circle class="af pop" stroke="none" cx="${320 + i * 22}" cy="${70 - i * 18}" r="${6 + i * 3}" style="animation-delay:${0.6 + i * 0.3}s"/>`).join("")}`,
  rain: () => `<path class="d" pathLength="1" d="M110 130 C 90 130, 80 100, 105 90 C 105 50, 160 45, 175 75 C 195 45, 260 55, 255 95 C 290 95, 295 135, 260 135 Z"/>
    ${[130, 170, 210, 240].map((x, i) => `<path class="a drop" stroke-width="6" fill="none" d="M${x} 160 L${x - 8} 185" style="animation-delay:${i * 0.25}s"/>`).join("")}
    <path class="d" pathLength="1" d="M60 270 C 130 250, 270 290, 340 270"/>`,
  sun: () => `<g transform="translate(200 150)"><circle class="af" r="55"/><g>${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<path class="d a" pathLength="1" transform="rotate(${a})" d="M0 -80 L0 -110"/>`).join("")}
    ${goT('attributeName="transform" type="rotate" from="0" to="360" dur="18s" repeatCount="indefinite"')}</g></g>
    <path class="d" pathLength="1" d="M40 270 C 120 230, 280 230, 360 270"/>`,
  checklist: () => `<rect class="d" pathLength="1" x="110" y="30" width="180" height="240" rx="14"/>
    ${[80, 140, 200].map((y, i) => `<path class="d" pathLength="1" d="M140 ${y} L160 ${y}"/><path class="d" pathLength="1" d="M185 ${y} L265 ${y}"/>
      <path class="a pop" stroke-width="8" fill="none" d="M135 ${y - 2} L145 ${y + 10} L165 ${y - 14}" style="animation-delay:${0.7 + i * 0.6}s"/>`).join("")}`,
  battery: () => `<rect class="d" pathLength="1" x="90" y="100" width="200" height="100" rx="14"/><path class="d" pathLength="1" d="M290 130 L305 130 L305 170 L290 170"/>
    <rect class="af" x="102" y="112" width="20" height="76" rx="6">${go('attributeName="width" values="20;176;176" keyTimes="0;.7;1" dur="4s" fill="freeze"')}</rect>`,
  plant: () => `<path class="d" pathLength="1" d="M140 200 L260 200 L245 270 L155 270 Z"/><path class="d" pathLength="1" d="M200 200 L200 110"/>
    <g style="transform-origin:200px 150px" class="grow"><path class="d a" pathLength="1" d="M200 150 C 160 140, 140 110, 150 90 C 180 95, 200 120, 200 150 Z M200 125 C 240 115, 260 85, 250 65 C 220 70, 200 95, 200 125 Z"/></g>`,
  chat: () => `<g class="pop" style="animation-delay:.3s"><rect class="d" pathLength="1" x="40" y="40" width="200" height="70" rx="30"/><path class="d" pathLength="1" d="M75 75 L200 75"/></g>
    <g class="pop" style="animation-delay:1.1s"><rect class="af" x="160" y="140" width="200" height="70" rx="30"/></g>
    <g class="pop" style="animation-delay:1.9s">${[0, 1, 2].map((i) => `<circle class="k" stroke="none" cx="${90 + i * 26}" cy="265" r="8">${go(`attributeName="cy" values="${["265;253;265;265", "265;265;253;265", "265;265;265;253"][i]}" dur=".9s" repeatCount="indefinite"`)}</circle>`).join("")}</g>`,
  path: () => `<path class="d a" pathLength="1" stroke-dasharray="1" d="M40 260 C 120 260, 100 160, 200 160 S 300 60, 360 60"/>
    <path class="af" stroke="none" d="M360 30 C 340 30, 330 50, 360 85 C 390 50, 380 30, 360 30 Z"/>
    <g class="mover"><animateMotion begin="indefinite" class="go" dur="5s" fill="freeze" path="M40 260 C 120 260, 100 160, 200 160 S 300 60, 340 70"/>${fig(0, -108, 0.6)}</g>`,
  bed: () => `<path class="d" pathLength="1" d="M50 220 L50 120 M50 180 L350 180 L350 240 M50 220 L350 220"/><path class="d a" pathLength="1" d="M120 180 C 140 140, 260 140, 330 180"/>
    <circle class="d" pathLength="1" cx="90" cy="160" r="20"/>
    <g class="fade"><text x="250" y="110" font-family="Fraunces" font-size="30" class="af" stroke="none">z</text><text x="285" y="80" font-family="Fraunces" font-size="22" class="af" stroke="none">z</text>
    ${goT('attributeName="transform" type="translate" values="0 0;10 -12;0 0" dur="2.6s" repeatCount="indefinite"')}</g>`,
  stairs: () => `<path class="d" pathLength="1" d="M40 270 L120 270 L120 210 L200 210 L200 150 L280 150 L280 90 L360 90"/>
    <g class="mover"><animateMotion begin="indefinite" class="go" dur="4s" fill="freeze" calcMode="discrete" values="80,150; 160,90; 240,30; 320,-30" keyTimes="0;.33;.66;1"/>${fig(0, 0, 0.55)}</g>
    <circle class="af pop" stroke="none" cx="360" cy="60" r="12" style="animation-delay:3.4s"/>`,
  thought: () => `${fig(110, 120, 0.9)}<circle class="d" pathLength="1" cx="170" cy="110" r="8"/><circle class="d" pathLength="1" cx="195" cy="85" r="12"/>
    <path class="d" pathLength="1" d="M230 70 C 210 40, 250 10, 285 25 C 315 5, 365 30, 350 65 C 375 90, 340 125, 305 110 C 285 135, 240 125, 240 100 C 215 100, 210 75, 230 70 Z"/>
    <g><path class="d a" pathLength="1" d="M255 70 C 270 50, 285 90, 300 65 C 312 50, 322 80, 335 68"/>${go('attributeName="opacity" values="1;.25;1" dur="1.2s" repeatCount="indefinite"')}</g>`,
};
export const VISUALS = Object.keys(DRAW);

/** Looks: colours per step, a moving background, how steps hand over, where the words sit. */
export const THEMES = {
  paper: { bgs: ["#dce6d6", "#f1d9c8", "#d5e2ec", "#efd6dc", "#ede3cc"], ink: "#2b2b2b", sub: "#4f4a42", acc: "#bb8a52", deco: "grain", tr: "fade", layout: "top" },
  night: { bgs: ["#1f2a44", "#26304a", "#2c2a4a", "#1d3343"], ink: "#f3ede1", sub: "#c9cfdd", acc: "#f2c66d", deco: "stars", tr: "rise", layout: "top" },
  sunset: { bgs: ["linear-gradient(180deg,#f8d9c4,#f1b8c0)", "linear-gradient(180deg,#f6e2c6,#f4c3a9)", "linear-gradient(180deg,#f3d1dc,#e7c3e6)"], ink: "#3d2440", sub: "#6a4a6c", acc: "#e0605b", deco: "orbs", tr: "slide", layout: "card" },
  ocean: { bgs: ["linear-gradient(180deg,#d6ecf3,#a9d0e4)", "linear-gradient(180deg,#e2f0ee,#b6dcd6)", "linear-gradient(180deg,#d9e4f5,#b3c6ea)"], ink: "#17324a", sub: "#3e5b74", acc: "#ffffff", deco: "waves", tr: "wipe", layout: "top" },
  forest: { bgs: ["#cfdcc6", "#dfe6cf", "#c7d8cf", "#e4ead8"], ink: "#1f3a2b", sub: "#4a6352", acc: "#c9962f", deco: "leaves", tr: "zoom", layout: "card" },
  stripes: { bgs: ["#f6e7b8", "#f3dcc9", "#dde9d1", "#d9e2f0"], ink: "#2d2a26", sub: "#57524a", acc: "#e48a3c", deco: "stripes", tr: "slideup", layout: "top" },
  bold: { bgs: ["#cdbfe8", "#bfe3d4", "#f5c9b0", "#bcd4f2", "#f2d98b"], ink: "#1e1b2e", sub: "#3f3b52", acc: "#ffffff", deco: "number", tr: "pop", layout: "big" },
};
export const THEME_NAMES = Object.keys(THEMES);
export const themeFor = (seedText) => THEME_NAMES[[...String(seedText)].reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, 5381) % THEME_NAMES.length];

const decoHtml = (deco, i) => {
  if (deco === "stars") return `<div class="deco">${Array.from({ length: 22 }, (_, k) => `<i class="star" style="left:${(k * 47 + i * 13) % 100}%;top:${(k * 29 + 7) % 100}%;animation-delay:${(k % 7) * 0.4}s"></i>`).join("")}</div>`;
  if (deco === "orbs") return `<div class="deco"><i class="orb o1"></i><i class="orb o2"></i></div>`;
  if (deco === "waves") return `<div class="deco"><svg class="sea" viewBox="0 0 1080 200" preserveAspectRatio="none"><path class="s1" d="M0 80 Q 135 40 270 80 T 540 80 T 810 80 T 1080 80 T 1350 80 T 1620 80 L1620 200 L0 200 Z"/><path class="s2" d="M0 110 Q 135 70 270 110 T 540 110 T 810 110 T 1080 110 T 1350 110 T 1620 110 L1620 200 L0 200 Z"/></svg></div>`;
  if (deco === "leaves") return `<div class="deco">${Array.from({ length: 7 }, (_, k) => `<i class="leaf" style="left:${(k * 15 + 5) % 100}%;animation-delay:${k * 0.9}s;animation-duration:${7 + (k % 3)}s"></i>`).join("")}</div>`;
  if (deco === "stripes") return `<div class="deco"><i class="band"></i></div>`;
  if (deco === "number") return `<div class="deco"><b class="bignum">${i + 1}</b></div>`;
  return `<div class="deco grain"></div>`;
};

export function explainHtml(steps, themeName, esc) {
  const th = THEMES[themeName] ?? THEMES.paper;
  return steps.map((st, i) => `<div class="ex tr-${th.tr} lay-${th.layout}" id="ex${i}" style="background:${th.bgs[i % th.bgs.length]}">
    ${decoHtml(th.deco, i)}
    <div class="exn">${i + 1} / ${steps.length}</div>
    <svg viewBox="0 -50 400 350" class="exs" overflow="visible">${(DRAW[st.visual] ?? DRAW.wave)()}</svg>
    <div class="txt"><h2>${esc(st.title)}</h2><p>${esc(st.text ?? "")}</p></div></div>`).join("");
}

export function explainCss(themeName) {
  const th = THEMES[themeName] ?? THEMES.paper;
  return `
  #explain { background: ${th.bgs[0]}; --ink: ${th.ink}; --sub: ${th.sub}; --acc: ${th.acc}; }
  .ex { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; padding: 120px 44px 0; box-sizing: border-box; opacity: 0; overflow: hidden;
        transition: opacity .35s, transform .5s cubic-bezier(.22,.8,.2,1), clip-path .55s cubic-bezier(.65,0,.35,1); }
  .ex.in { opacity: 1; }
  .tr-slide { transform: translateX(60px); } .tr-slide.in { transform: none; }
  .tr-slideup { transform: translateY(70px); } .tr-slideup.in { transform: none; }
  .tr-rise { transform: translateY(24px); } .tr-rise.in { transform: none; }
  .tr-zoom { transform: scale(1.08); } .tr-zoom.in { transform: none; }
  .tr-pop { transform: scale(.92); } .tr-pop.in { transform: none; }
  .tr-wipe { clip-path: inset(0 100% 0 0); opacity: 1; } .tr-wipe.in { clip-path: inset(0 0 0 0); }
  .exn { position: relative; z-index: 2; font-size: 20px; letter-spacing: 1px; color: var(--sub); margin-bottom: 20px; }
  .exs { position: relative; z-index: 2; width: 452px; height: 340px; fill: none; stroke: var(--ink); stroke-width: 6; stroke-linecap: round; stroke-linejoin: round; }
  .exs .a { stroke: var(--acc); } .exs .af { fill: var(--acc); } .exs .k { fill: var(--ink); }
  .exs .d { stroke-dasharray: 1; stroke-dashoffset: 1; }
  .ex.in .d { transition: stroke-dashoffset .9s cubic-bezier(.45,.05,.4,1); stroke-dashoffset: 0; }
  .exs .mover { opacity: 0; } .ex.in .mover { opacity: 1; }
  .exs .fade, .exs .pop { opacity: 0; } .ex.in .fade { transition: opacity .7s .6s; opacity: 1; }
  .ex.in .pop { animation: pop .5s forwards; } @keyframes pop { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  .exs .steam { opacity: 0; } .ex.in .steam { animation: steam 2.4s ease-in-out infinite; } @keyframes steam { 0% { opacity: 0; transform: translateY(10px); } 40% { opacity: .9; } 100% { opacity: 0; transform: translateY(-22px); } }
  .exs .drop { opacity: 0; } .ex.in .drop { animation: drop 1s linear infinite; } @keyframes drop { 0% { opacity: 0; transform: translateY(-10px); } 30% { opacity: 1; } 100% { opacity: 0; transform: translateY(70px); } }
  .ex.in .grow { animation: grow 1.6s cubic-bezier(.22,.8,.2,1) .6s both; } @keyframes grow { from { transform: scale(0); } to { transform: scale(1); } }
  .txt { position: relative; z-index: 2; display: flex; flex-direction: column; align-items: center; }
  .lay-card .txt { margin-top: 24px; padding: 22px 26px 26px; border-radius: 26px; background: rgba(255,255,255,.72); }
  .lay-big .exs { width: 400px; height: 300px; }
  .ex h2 { font-family: Fraunces, serif; font-weight: 600; font-size: 42px; line-height: 1.1; color: var(--ink); text-align: center; margin: 34px 0 0; letter-spacing: -.5px;
           opacity: 0; transform: translateY(10px); transition: opacity .4s .3s, transform .4s .3s; }
  .lay-card h2 { margin-top: 0; } .lay-big h2 { font-size: 50px; }
  .ex p { font-size: 25px; line-height: 1.42; color: var(--sub); text-align: center; margin: 18px 6px 0; opacity: 0; transition: opacity .5s .65s; }
  .ex.in h2 { opacity: 1; transform: none; } .ex.in p { opacity: 1; }
  .ex.in .exs { animation: floaty 4.2s ease-in-out 1s infinite; } @keyframes floaty { 0%, 100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-9px) rotate(-1deg); } }
  .deco { position: absolute; inset: 0; z-index: 1; pointer-events: none; }
  .grain { background-image: radial-gradient(rgba(0,0,0,.05) 1px, transparent 1.2px); background-size: 6px 6px; }
  .star { position: absolute; width: 4px; height: 4px; border-radius: 50%; background: #fff7d6; animation: tw 2.4s ease-in-out infinite; }
  @keyframes tw { 0%, 100% { opacity: .15; transform: scale(.7); } 50% { opacity: .95; transform: scale(1.2); } }
  .orb { position: absolute; border-radius: 50%; filter: blur(28px); opacity: .55; }
  .o1 { width: 300px; height: 300px; left: -80px; top: 520px; background: #ffd0a8; animation: drift 9s ease-in-out infinite; }
  .o2 { width: 240px; height: 240px; right: -60px; top: 80px; background: #f6a8c0; animation: drift 11s ease-in-out infinite reverse; }
  @keyframes drift { 0%, 100% { transform: translate(0,0); } 50% { transform: translate(40px,-30px); } }
  .sea { position: absolute; left: 0; bottom: 0; width: 200%; height: 170px; }
  .sea .s1 { fill: rgba(255,255,255,.35); animation: sea 7s linear infinite; } .sea .s2 { fill: rgba(255,255,255,.55); animation: sea 11s linear infinite; }
  @keyframes sea { from { transform: translateX(0); } to { transform: translateX(-540px); } }
  .leaf { position: absolute; top: -40px; width: 22px; height: 12px; border-radius: 0 12px; background: ${th.acc}; opacity: .55; animation: fall linear infinite; }
  @keyframes fall { 0% { transform: translate(0,0) rotate(0); } 100% { transform: translate(60px,1000px) rotate(540deg); } }
  .band { position: absolute; left: -10%; right: -10%; bottom: 60px; height: 90px; transform: rotate(-4deg);
          background: repeating-linear-gradient(90deg, ${th.acc} 0 26px, transparent 26px 52px); opacity: .35; animation: band 3s linear infinite; }
  @keyframes band { from { background-position: 0 0; } to { background-position: 52px 0; } }
  .bignum { position: absolute; right: 26px; bottom: -40px; font-family: Fraunces, serif; font-size: 420px; line-height: 1; color: rgba(255,255,255,.45); }
  #hook { background: ${themeName === "night" ? "rgba(243,237,225,.92)" : "rgba(43,43,43,.88)"}; color: ${themeName === "night" ? "#1f2a44" : "#fffdf7"}; }
`;
}
