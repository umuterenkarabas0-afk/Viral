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
  dice: '<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><circle cx="8.5" cy="8.5" r="1.1" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.1" fill="currentColor"/><circle cx="12" cy="12" r="1.1" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.1" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.1" fill="currentColor"/>',
  brain: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a2.5 2.5 0 0 0-3-1z"/><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/>',
  bottle: '<path d="M10 2h4v4l2 3v12a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9l2-3z"/><path d="M8 13h8"/>',
  fingerprint: '<path d="M6 10a6 6 0 0 1 12 0v2"/><path d="M9 21c1-3 1-6 1-9a2 2 0 0 1 4 0c0 4-.5 7-2 10"/><path d="M5 15c.5-1.5 1-3 1-5M18 12c0 3-.5 5.5-1.5 8"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  swap: '<path d="M7 4 3 8l4 4"/><path d="M3 8h13a4 4 0 0 1 0 8h-2"/><path d="m17 20 4-4-4-4"/>',
};

export function icon(name, size = 40, stroke = 2.2) {
  const d = P[name] || P.sparkle;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
}

export const ICON_NAMES = Object.keys(P);
