// Запасные иллюстрации демо-сказки (I12): акварельные SVG в духе TALE_STYLE, без текста на картинке.
// Используются, если в хранилище нет «золотых» картинок (illustrations/_demo/tale/p<i>.*) —
// например, ключа OpenAI нет или Wi-Fi на сцене лёг. Рисуются без сети и без ИИ.

const PAPER = "#f6efe3";

function frame(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
<defs>
<filter id="wc" x="-10%" y="-10%" width="120%" height="120%">
<feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="7" result="n"/>
<feDisplacementMap in="SourceGraphic" in2="n" scale="18" result="d"/>
<feGaussianBlur in="d" stdDeviation="1.6"/>
</filter>
<filter id="paper"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3"/><feColorMatrix values="0 0 0 0 0.45 0 0 0 0 0.36 0 0 0 0 0.25 0 0 0 0.08 0"/></filter>
</defs>
<rect width="1024" height="1024" fill="${PAPER}"/>
<g filter="url(#wc)" opacity="0.92">${body}</g>
<rect width="1024" height="1024" filter="url(#paper)"/>
</svg>`;
}

/** Простое доброе лицо: круг и точки-глаза, улыбка дугой. */
function face(cx: number, cy: number, r: number, skin = "#f1c9a5"): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${skin}"/>
<circle cx="${cx - r * 0.35}" cy="${cy - r * 0.1}" r="${r * 0.08}" fill="#4a3a30"/>
<circle cx="${cx + r * 0.35}" cy="${cy - r * 0.1}" r="${r * 0.08}" fill="#4a3a30"/>
<path d="M${cx - r * 0.3} ${cy + r * 0.3} Q${cx} ${cy + r * 0.55} ${cx + r * 0.3} ${cy + r * 0.3}" stroke="#a0523d" stroke-width="${r * 0.08}" fill="none" stroke-linecap="round"/>`;
}

function person(x: number, y: number, s: number, coat: string, hair = "#3b2e28"): string {
  return `<path d="M${x - 70 * s} ${y + 230 * s} Q${x} ${y + 40 * s} ${x + 70 * s} ${y + 230 * s} Z" fill="${coat}"/>
<circle cx="${x}" cy="${y - 4 * s}" r="${52 * s}" fill="${hair}"/>
${face(x, y + 14 * s, 46 * s)}`;
}

/** 1. Семья приезжает в осеннюю степь, соседи несут молоко и лепёшки. */
const p0 = frame(`
<rect y="0" width="1024" height="560" fill="#f3d9b1"/>
<circle cx="800" cy="200" r="90" fill="#f0b46a" opacity="0.8"/>
<path d="M0 560 Q260 500 520 560 T1024 540 L1024 1024 L0 1024 Z" fill="#d8b46a"/>
<path d="M0 700 Q300 640 600 700 T1024 690 L1024 1024 L0 1024 Z" fill="#c99d55" opacity="0.8"/>
${person(230, 560, 1.1, "#7a8f6a")}
${person(360, 600, 0.8, "#b8402f")}
${person(130, 620, 0.75, "#6f7fa0")}
${person(700, 560, 1.1, "#9a6b4a", "#2f2622")}
<ellipse cx="610" cy="740" rx="44" ry="18" fill="#e7c38a"/><ellipse cx="610" cy="726" rx="44" ry="18" fill="#efd19c"/>
<path d="M800 690 Q830 640 860 690 L852 790 L808 790 Z" fill="#f4f1ea" stroke="#9a8a78" stroke-width="5"/>
`);

/** 2. Зимний вечер: мама варит кукси, четверо детей греются у печки. */
const p1 = frame(`
<rect width="1024" height="1024" fill="#efe0c8"/>
<rect x="80" y="120" width="260" height="220" rx="16" fill="#9fb4cf"/>
<circle cx="150" cy="190" r="10" fill="#fff"/><circle cx="250" cy="250" r="8" fill="#fff"/><circle cx="300" cy="170" r="7" fill="#fff"/>
<rect x="560" y="360" width="340" height="420" rx="40" fill="#c98f6a"/>
<rect x="620" y="520" width="220" height="140" rx="30" fill="#e7743e"/>
<ellipse cx="730" cy="350" rx="120" ry="34" fill="#6b5b52"/>
<path d="M700 300 q-20 -50 0 -90 M760 300 q20 -50 0 -90" stroke="#c9bfb4" stroke-width="10" fill="none" stroke-linecap="round" opacity="0.7"/>
${person(840, 200, 1.0, "#7a8f6a")}
${person(170, 640, 0.75, "#b8402f")}
${person(300, 670, 0.7, "#6f7fa0")}
${person(420, 650, 0.72, "#d6a24a")}
${person(530, 700, 0.62, "#8c6fa0")}
<rect y="900" width="1024" height="124" fill="#b98a5e"/>
`);

/** 3. Два брата и одна тетрадь на двоих. */
const p2 = frame(`
<rect width="1024" height="1024" fill="#f1e4cc"/>
<rect x="120" y="560" width="784" height="60" rx="10" fill="#a8764f"/>
<rect x="170" y="620" width="40" height="300" fill="#8e613f"/><rect x="814" y="620" width="40" height="300" fill="#8e613f"/>
<path d="M392 520 L512 545 L632 520 L632 560 L512 585 L392 560 Z" fill="#fbf7ef" stroke="#9a8a78" stroke-width="4"/>
<path d="M412 532 L492 548 M412 546 L480 560" stroke="#4a6fa0" stroke-width="4"/>
<path d="M612 532 L532 548 M612 546 L544 560" stroke="#4a6fa0" stroke-width="4"/>
${person(260, 300, 1.1, "#7a8f6a")}
${person(770, 320, 1.05, "#b8402f")}
<circle cx="880" cy="160" r="60" fill="#f0b46a" opacity="0.6"/>
`);

/** 4. Весна: большая семья за столом, дедушка и внуки. */
const p3 = frame(`
<rect width="1024" height="600" fill="#dbe8d2"/>
<circle cx="180" cy="170" r="80" fill="#f4c7c3" opacity="0.8"/><circle cx="260" cy="130" r="60" fill="#f7d6d2" opacity="0.8"/>
<circle cx="860" cy="190" r="90" fill="#f4c7c3" opacity="0.7"/>
<path d="M0 600 Q512 540 1024 600 L1024 1024 L0 1024 Z" fill="#a9c48f"/>
<rect x="190" y="640" width="644" height="40" rx="10" fill="#b8402f" opacity="0.85"/>
<ellipse cx="330" cy="630" rx="60" ry="22" fill="#fbf7ef"/><ellipse cx="512" cy="630" rx="70" ry="24" fill="#f3e2b5"/><ellipse cx="690" cy="630" rx="60" ry="22" fill="#fbf7ef"/>
${person(512, 330, 1.15, "#6f7fa0", "#d9d4cc")}
${person(300, 420, 0.8, "#d6a24a")}
${person(720, 420, 0.82, "#7a8f6a")}
${person(170, 470, 0.65, "#8c6fa0")}
${person(860, 470, 0.65, "#e7743e")}
`);

export const DEMO_TALE_ART: readonly string[] = [p0, p1, p2, p3];
