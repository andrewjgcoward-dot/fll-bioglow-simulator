// BioGlow (FLL Challenge 2026-27) field data. Units: millimetres, origin at the
// bottom-left corner of the mat, y pointing away from the home wall.
// Positions are traced from the official wireframe PDF (20 cm grid) and are approximate.

export const FW = 2000;
export const FH = 1143;
export const HOME_R = 484;

// r = rotation in degrees, clockwise.
export const MODELS = [
  { n: '01', name: 'M01 Drone Survey', x: 1055, y: 220, w: 85, h: 80, r: 30 },
  { n: '02', name: 'M02 Exploding Seeds', x: 630, y: 540, w: 70, h: 60, r: 20 },
  { n: '03', name: 'M03 Flip the Rock', x: 80, y: 658, w: 125, h: 50, r: 0 },
  { n: '04', name: 'M04 Lucky Leaves', x: 116, y: 1020, w: 145, h: 130, r: 0 },
  { n: '05', name: 'M05 Reaching Roots', x: 402, y: 1090, w: 40, h: 60, r: 0 },
  { n: '08 09', name: 'M08 Tangled / M09 Research Platform', x: 578, y: 1068, w: 159, h: 103, r: 0 },
  { n: '10', name: 'M10 Fragile Microhabitats', x: 749, y: 1048, w: 45, h: 45, r: 0 },
  { n: '10', name: 'M10 Fragile Microhabitats', x: 1040, y: 720, w: 45, h: 35, r: 0 },
  { n: '06 07', name: 'M06 Leafcutter Frenzy / M07 Humongous Fungus', x: 1542, y: 1072, w: 159, h: 120, r: 0 },
  { n: '11', name: 'M11 Window to the Past', x: 1406, y: 594, w: 80, h: 80, r: 45 },
  { n: '12', name: 'M12 Forest Elder', x: 1940, y: 758, w: 73, h: 73, r: 0, round: true },
  { n: '12', name: 'M12 Forest Elder post', x: 1940, y: 538, w: 25, h: 45, r: 0 },
  { n: '', name: 'model at F1', x: 1149, y: 56, w: 72, h: 72, r: 0, round: true }
];

// Interchangeable docks for missions 13-15.
export const DOCKS = [
  { name: 'dock 1', x: 998, y: 627, w: 91, h: 139, r: 0 },
  { name: 'dock 2', x: 1880, y: 1030, w: 120, h: 80, r: -40 },
  { name: 'dock 3', x: 1282, y: 91, w: 85, h: 131, r: 0 }
];

// Black lines printed on the mat (polylines), about 20 mm wide.
export const LINES = [
  [[470, 812], [513, 892], [756, 892]],
  [[1331, 973], [1431, 876], [1683, 876]],
  [[940, 422], [1008, 306]]
];

// Scoring, from the 2026-27 BioGlow Robot Game Rulebook.
export const MISSIONS = [
  { id: 'M01', name: 'Drone Survey', items: [{ k: 'm01a', label: 'Drone no longer touching the mat', pts: 20 }, { k: 'm01b', label: 'Bonus: LiDAR map flipped, scan marker in survey area', pts: 10, req: 'm01a' }] },
  { id: 'M02', name: 'Exploding Seeds', items: [{ k: 'm02', label: 'Seeds no longer touching the stalk (each)', pts: 10, count: true }] },
  { id: 'M03', name: 'Flip the Rock', items: [{ k: 'm03a', label: 'Research flag is down', pts: 20 }, { k: 'm03b', label: 'Bonus: rock back in its starting position', pts: 10, req: 'm03a' }] },
  { id: 'M04', name: 'Lucky Leaves', items: [{ k: 'm04a', label: 'One leaf removed, not touching the nest', pts: 10 }, { k: 'm04b', label: 'Bonus: second leaf removed, katydid in its starting position', pts: 20, req: 'm04a' }, { k: 'm04x', label: 'Katydid outside the leaf habitat (mission scores 0)', pts: 0, zero: true }] },
  { id: 'M05', name: 'Reaching Roots', items: [{ k: 'm05a', label: 'Plant root partially extended', pts: 10, group: 'm05' }, { k: 'm05b', label: 'Plant root completely extended', pts: 20, group: 'm05' }] },
  { id: 'M06', name: 'Leafcutter Frenzy', items: [{ k: 'm06', label: 'Ant touching the nest, leaf fragments inside (each)', pts: 10, count: true }] },
  { id: 'M07', name: 'Humongous Fungus', items: [{ k: 'm07a', label: 'Mycelium completely extended', pts: 20 }, { k: 'm07b', label: 'Bonus: connection with the opposing team’s extended root', pts: 10, req: 'm07a' }] },
  { id: 'M08', name: 'Tangled', items: [{ k: 'm08', label: 'The vine is touching the mat', pts: 30 }] },
  { id: 'M09', name: 'Research Platform', noEquip: true, items: [{ k: 'm09a', label: 'Research platform raised', pts: 10 }, { k: 'm09b', label: 'Camera trap deployed', pts: 10 }, { k: 'm09c', label: 'Seed no longer touching the tree', pts: 10 }] },
  { id: 'M10', name: 'Fragile Microhabitats', noEquip: true, items: [{ k: 'm10a', label: 'Spider habitat in its starting position', pts: 10 }, { k: 'm10b', label: 'Snail habitat in its starting position', pts: 10 }] },
  { id: 'M11', name: 'Window to the Past', items: [{ k: 'm11', label: 'Root cover down, touching the mat', pts: 20 }] },
  { id: 'M12', name: 'Forest Elder', noEquip: true, items: [{ k: 'm12a', label: 'Cane completely raised, touching the tree', pts: 20 }, { k: 'm12b', label: 'Support tie around the post', pts: 10 }] },
  { id: 'M13', name: 'Keystone Species', items: [{ k: 'm13', label: 'Your keystone species on the restoration platform, young trees raised', pts: 30 }] },
  { id: 'M14', name: 'Seeds of Renewal', items: [{ k: 'm14a', label: 'Seeds in the replantation station (each)', pts: 5, count: true }, { k: 'm14b', label: 'Bonus: of those, seeds touching the mat (each)', pts: 5, count: true, capBy: 'm14a' }] },
  { id: 'M15', name: 'Biocentric Architecture', items: [{ k: 'm15a', label: 'Nesting canopy raised', pts: 10 }, { k: 'm15b', label: 'Garden skylight completely in', pts: 10 }, { k: 'm15c', label: 'Compost hatch opened, touching the mat', pts: 10 }, { k: 'm15d', label: 'Environmental bonus: the dock’s greatest need is done (mine: canopy, city: skylight, farm: hatch)', pts: 10 }] }
];

export const TOKEN_PTS = [0, 10, 15, 25, 35, 50, 50];
export const MATCH_SECONDS = 150;

export function missionPoints(m, score) {
  let t = 0, zero = false;
  for (const it of m.items) {
    const v = score[it.k];
    if (it.zero) { if (v) zero = true; continue; }
    if (it.count) { let n = v || 0; if (it.capBy) n = Math.min(n, score[it.capBy] || 0); t += n * it.pts; }
    else if (v && (!it.req || score[it.req])) t += it.pts;
  }
  return zero ? 0 : t;
}

export function totalScore(score, tokens, inspection) {
  let t = 0;
  for (const m of MISSIONS) t += missionPoints(m, score);
  return t + TOKEN_PTS[tokens] + (inspection ? 20 : 0);
}
