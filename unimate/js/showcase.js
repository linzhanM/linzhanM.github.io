// Work-in-progress mixed-character stage, kept apart from the public catalog
// entries while it is tuned: both entry points hide it through
// `hiddenCategories`. Drop the label there to resume testing.
export const SHOWCASE_EXAMPLE = {
  label: 'Showcase',
  files: [
    { url: 'resources/glbs/garfield.glb', row: 0, scale: 1.28, rotate: [0, 12, 0], material: { colorScale: 0.72 } },
    { url: 'resources/glbs/wall-e-greet.glb', row: 0, scale: 1.12, groundToMesh: true, material: { colorScale: 0.78 } },
    { url: 'resources/glbs/radar.glb', row: 1, scale: 1.5, rotate: [0, 30, 0], groundFrame: 1, groundToMesh: true, material: { roughness: 0.3, metalness: 0.7 } },
    { url: 'resources/glbs/baymax-punch.glb', row: 1, scale: 1.4, labelOffset: [0, -18], material: { colorScale: 0.68 } },
    { url: 'resources/glbs/quadruped-spot.glb', row: 1, scale: 1.02, rotate: [0, -18, 0], material: { colorScale: 0.6 } },
    { url: 'resources/glbs/dragon.glb', scale: 2.0, above: [3, 1.5], offset: [-0.5, 0, 12], material: { colorScale: 0.7, roughness: 0.3, emissiveIntensity: 0.4 } },
  ],
  rowSpacing: { 0: 1.18, 1: 1.08 },
  rowDepth: 2.15,
  pad: 1.34,
  evenGaps: true,
  lighting: 2.0,
};
