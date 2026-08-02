// Full-screen-only catalog shaping. The embedded project-page catalog preserves
// the original combined robot stage; the motion lab splits it into focused rows.
export function prepareInteractiveCatalog(examples) {
  const humanoidRobotIndex = examples.findIndex(({ label }) => label === 'Humanoid Robot');
  if (humanoidRobotIndex < 0) return examples;

  const combined = examples[humanoidRobotIndex];
  const gundam = {
    label: 'Gundam Robot',
    files: combined.files.slice(0, 4).map((file) => ({ ...file, scale: 1.0 })),
    spacing: 1.0,
    pad: 0.9,
  };
  const humanoid = {
    label: 'Humanoid Robot',
    files: combined.files.slice(4).map(({ row, ...file }) => file),
    spacing: 1.1,
    pad: 1.1,
  };

  examples.splice(humanoidRobotIndex, 1, humanoid, gundam);

  const quadrupedIndex = examples.findIndex(({ label }) => label === 'Quadruped Robot');
  if (quadrupedIndex >= 0) {
    const [quadruped] = examples.splice(quadrupedIndex, 1);
    examples.splice(humanoidRobotIndex, 0, quadruped);
  }

  return examples;
}
