// The map: RUSTLINE yard, an original industrial site. 52 x 36 m, attacker
// spawn south, defender spawn north, two bomb sites (A Foundry west, B Silo
// east), a divider wall with three lanes through it, crates and containers for
// cover. Every box is a collider for movement and a surface a bullet stops on.
// Waypoints graph underpins the bots: nodes in open ground, edges between
// neighbours, BFS over them.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoint nodes: [x, z]. Indices are stable; EDGES lists neighbours.
const NODES = [
  [-4, 14], [0, 15], [4, 14], // 0-2 attacker spawn
  [-8, 10], [0, 10], [8, 10], // 3-5 south mid
  [-13, 0], [0, 0], [13, 0], // 6-8 divider gaps
  [-8, -6], [0, -6], [8, -6], // 9-11 north mid
  [-13, -6], [-18, -4], [-20, -9], [-20, -14], // 12-15 site A approach + hold
  [13, -6], [18, -4], [20, -9], [20, -14], // 16-19 site B approach + hold
  [-6, -14], [0, -15], [6, -14], // 20-22 defender spawn
  [-13, -11], [13, -11], [0, -12], // 23-25 defender holds
];
const EDGES = [
  [0, 3], [1, 4], [2, 5], [3, 4], [4, 5],
  [3, 6], [4, 7], [5, 8],
  [6, 9], [7, 10], [8, 11],
  [9, 12], [9, 10], [10, 11], [11, 16],
  [12, 13], [13, 14], [14, 15], [15, 23],
  [16, 17], [17, 18], [18, 19], [19, 24],
  [9, 23], [11, 24], [10, 25], [23, 20], [24, 22], [25, 21],
  [20, 21], [21, 22], [20, 23], [22, 24],
  [6, 12], [8, 16], [13, 23], [17, 24],
];

export const SITES = {
  A: { name: 'A Foundry', center: new THREE.Vector3(-20, 0, -9), radius: 5, color: 'accent' },
  B: { name: 'B Silo', center: new THREE.Vector3(20, 0, -9), radius: 5, color: 'teal' },
};

export const SPAWNS = {
  atk: [
    { x: -4, z: 14, yaw: 0 },
    { x: 0, z: 15, yaw: 0 },
    { x: 4, z: 14, yaw: 0 },
  ],
  def: [
    { x: -6, z: -14, yaw: Math.PI },
    { x: 0, z: -15, yaw: Math.PI },
    { x: 6, z: -14, yaw: Math.PI },
  ],
};

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'teal' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.03,
    });
  }

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Floor and perimeter: 52 x 36 m, walls 5 m high.
  box(52.4, 0.4, 36.4, 0, -0.2, 0, 'ground');
  box(0.4, 5, 36.4, -26.2, 2.5, 0, 'wall');
  box(0.4, 5, 36.4, 26.2, 2.5, 0, 'wall');
  box(52.4, 5, 0.4, 0, 2.5, -18.2, 'wall');
  box(52.4, 5, 0.4, 0, 2.5, 18.2, 'wall');

  // Divider wall at z = 0 with three lanes: west gap, mid gap, east gap.
  box(11, 4.6, 0.4, -20.5, 2.3, 0, 'wall');
  box(8, 4.6, 0.4, -7, 2.3, 0, 'wall');
  box(8, 4.6, 0.4, 7, 2.3, 0, 'wall');
  box(11, 4.6, 0.4, 20.5, 2.3, 0, 'wall');

  // Site A enclosure (west): north wall and east wall, entrances south and mid.
  box(9, 4.6, 0.4, -20.5, 2.3, -13.4, 'wall');
  box(0.4, 4.6, 9.4, -15.4, 2.3, -8.7, 'wall');
  // Site B enclosure (east), mirrored.
  box(9, 4.6, 0.4, 20.5, 2.3, -13.4, 'wall');
  box(0.4, 4.6, 9.4, 15.4, 2.3, -8.7, 'wall');

  // Site pads, coloured so each site reads at a glance.
  box(5.6, 0.08, 5.6, -20, 0.04, -9, 'accent');
  box(5.6, 0.08, 5.6, 20, 0.04, -9, 'teal');

  // Cover: crates to crouch behind, pillars at the gaps, containers at the sites.
  box(2, 1.1, 2, 0, 0.55, 6, 'crate');
  box(1.6, 1.1, 1.6, -8, 0.55, 8, 'crate');
  box(1.6, 1.1, 1.6, 8, 0.55, 8, 'crate');
  box(1.2, 3.2, 1.2, -5, 1.6, 2, 'wall');
  box(1.2, 3.2, 1.2, 5, 1.6, 2, 'wall');
  box(1.6, 1.1, 1.6, -12, 0.55, -6, 'crate');
  box(1.6, 1.1, 1.6, 12, 0.55, -6, 'crate');
  box(2.4, 1.1, 1.2, -19, 0.55, -3, 'crate');
  box(2.4, 1.1, 1.2, 19, 0.55, -3, 'crate');
  box(4.4, 2.4, 2.2, -21, 1.2, -14.6, 'container');
  box(4.4, 2.4, 2.2, 21, 1.2, -14.6, 'container');
  box(1.6, 1.1, 1.6, -6, 0.55, -12, 'crate');
  box(1.6, 1.1, 1.6, 6, 0.55, -12, 'crate');
  box(2.4, 0.9, 1.2, -3, 0.45, 12, 'crate');
  box(2.4, 0.9, 1.2, 3, 0.45, 12, 'crate');
  box(1.2, 2.2, 1.2, -10.4, 1.1, 14.6, 'crate');
  box(1.2, 2.2, 1.2, 10.4, 1.1, 14.6, 'crate');

  // Site signs: a canvas texture letter on a pole, so A and B read from anywhere.
  function sign(letter, colorName, x, z) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const g = canvas.getContext('2d');
    g.fillStyle = PALETTE[colorName];
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = PALETTE.canvas;
    g.font = 'bold 84px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(letter, 64, 70);
    const texture = new THREE.CanvasTexture(canvas);
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(1.8, 1.8),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }),
    );
    board.position.set(x, 3.4, z);
    const pole = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 3.4, 0.18),
      materials.wall,
    );
    pole.position.set(x, 1.7, z);
    pole.castShadow = true;
    group.add(board, pole);
    shootables.push(board);
  }
  sign('A', 'accent', -20, -13.2);
  sign('B', 'teal', 20, -13.2);

  // Dusk light: a low warm sun from the south-west, a cool fill from the north,
  // and a warm sky/ground gradient so the yard never goes black.
  const sky = new THREE.HemisphereLight(new THREE.Color('#a08a6a'), new THREE.Color(PALETTE.canvas), 1.7);
  scene.add(sky);

  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb066'), 3.0);
  sun.position.set(-18, 12, 22);
  sun.target.position.set(0, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -32;
  sun.shadow.camera.right = 32;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  sun.shadow.camera.far = 80;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);

  const fill = new THREE.DirectionalLight(new THREE.Color('#7fa3b8'), 0.7);
  fill.position.set(10, 14, -18);
  scene.add(fill);

  return {
    colliders,
    shootables,
    group,
    nodes: NODES.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    edges: EDGES,
  };
}
