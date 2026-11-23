// Basit çizgi ikonlar (24x24). Emoji yerine SVG kullanılır ki her ortamda aynı görünsün.
const P = {
  ruler: '<path d="M3 17 17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
  depth: '<path d="M12 3v13"/><path d="M7 11l5 5 5-5"/><path d="M3 21c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0"/>',
  weight: '<path d="M6 8h12l2 13H4z"/><circle cx="12" cy="5" r="2.2"/>',
  warning: '<path d="M12 3 2 20h20z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.3" r=".6" fill="currentColor"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  heart: '<path d="M12 20s-7-4.4-9-9a4.8 4.8 0 0 1 9-3 4.8 4.8 0 0 1 9 3c-2 4.6-9 9-9 9z"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  pin: '<path d="M12 21s-6-6.2-6-11a6 6 0 0 1 12 0c0 4.8-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
  fish: '<path d="M3 12c3-4 8-5.5 12-4l6-3v14l-6-3c-4 1.5-9 0-12-4z"/><circle cx="7.5" cy="11" r=".8" fill="currentColor"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  skull: '<path d="M12 3a8 8 0 0 0-5 14.2V20h10v-2.8A8 8 0 0 0 12 3z"/><circle cx="9" cy="11" r="1.6"/><circle cx="15" cy="11" r="1.6"/><path d="M10 20v-2M14 20v-2"/>',
  sparkle: '<path d="M12 2v6M12 16v6M2 12h6M16 12h6"/><path d="m5 5 3 3M16 16l3 3M19 5l-3 3M8 16l-3 3"/>',
  dna: '<path d="M7 3c0 6 10 6 10 12s-10 6-10 6"/><path d="M17 3c0 6-10 6-10 12"/><path d="M8.5 7h7M8.5 17h7"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
  wave: '<path d="M2 9c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0"/><path d="M2 15c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  food: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10"/><path d="M17 21V3c-2 1-3 4-3 8h3"/>',
  sound: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  thermo: '<path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z"/>',
  comment: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  temple: '<path d="M3 9 12 4l9 5"/><path d="M5 9v9M9.5 9v9M14.5 9v9M19 9v9M3 20h18"/>',
  crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>',
  swap: '<path d="M7 4 3 8l4 4"/><path d="M3 8h13a4 4 0 0 1 0 8h-2"/><path d="m17 20 4-4-4-4"/>',
  planet: '<circle cx="12" cy="12" r="5.5"/><path d="M4.2 15.8C1.8 17.6 1 19.2 1.7 20c1.3 1.5 7.4-1.4 13.6-6.5S24.8 4 23.5 2.6c-.7-.8-2.6-.3-5 1.2"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/>',
  rocket: '<path d="M12 2c3 2.5 4.5 6 4.5 10.5L14 16h-4l-2.5-3.5C7.5 8 9 4.5 12 2z"/><circle cx="12" cy="9" r="1.6"/><path d="M8 14l-3 3 1 3 3-2M16 14l3 3-1 3-3-2M10.5 18.5 12 22l1.5-3.5"/>',
  wind: '<path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h16a3 3 0 1 1-3 3"/><path d="M3 16h7"/>',
  volcano: '<path d="M2 21h20l-6-9h-2l-1.2-2h-1.6L10 12H8z"/><path d="M12 7V3M9 5 7.5 3M15 5l1.5-2"/>',
  snowflake: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7"/><path d="m9 4 3 2 3-2M9 20l3-2 3 2M4 10.5l3-.5 1-3M20 13.5l-3 .5-1 3M4 13.5l3 .5 1 3M20 10.5l-3-.5-1-3"/>',
  drop: '<path d="M12 2.5S5.5 10 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 10 12 2.5 12 2.5z"/><path d="M9 15a3 3 0 0 0 3 3"/>',
  flame: '<path d="M12 22c4.4 0 7-2.9 7-6.6 0-3.8-2.6-6-4.2-9.4-.4 2.4-1.6 3.7-2.8 4.4.3-3.3-1.2-6.4-4-8.4.3 3.4-3 6-3 10.6C5 19.1 7.6 22 12 22z"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 3.5v4.5h-4.5"/>',
  mountain: '<path d="M2 20 9 7l4 6 2.5-3.5L22 20z"/><path d="m7.3 10.2 1.7 1.3 1.6-1.6"/>',
  orbit: '<circle cx="12" cy="12" r="2.6"/><ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(-25 12 12)"/><circle cx="20" cy="8" r="1.2" fill="currentColor"/>',
  telescope: '<path d="m3 13 13-7 2 4-13 7z"/><path d="m16 6 3-1.5 2 4-3 1.5M9 15l-3 7M10 14l3 8"/>',
  gauge: '<path d="M4 18a9 9 0 1 1 16 0"/><path d="m12 14 4-5"/><circle cx="12" cy="14" r="1.3" fill="currentColor"/>',
};

export function icon(name, size = 40, stroke = 2.2) {
  const d = P[name] || P.sparkle;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
}

export const ICON_NAMES = Object.keys(P);
